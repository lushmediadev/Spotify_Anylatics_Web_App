"""Playwright fallback scraper for Spotify Web pages."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

from playwright.async_api import Browser, Page, async_playwright

from app.config import settings

logger = logging.getLogger(__name__)

SPOTIFY_OPEN = "https://open.spotify.com"
_DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_browser_lock = asyncio.Lock()
_playwright_instance = None
_browser: Browser | None = None
_semaphore = asyncio.Semaphore(max(1, settings.PLAYWRIGHT_MAX_CONCURRENCY))
_track_cache: dict[str, dict[str, Any]] = {}


def _to_int(raw: str | None) -> int | None:
    if not raw:
        return None

    text = raw.strip().replace("\u202f", "").replace(" ", "")
    compact_match = re.fullmatch(r"(?i)(\d+(?:[.,]\d+)?)([kmb])", text)
    if compact_match:
        base_raw = compact_match.group(1).replace(",", ".")
        suffix = compact_match.group(2).lower()
        multiplier = {"k": 1_000, "m": 1_000_000, "b": 1_000_000_000}[suffix]
        try:
            return int(float(base_raw) * multiplier)
        except ValueError:
            return None

    digits = re.sub(r"[^\d]", "", text)
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None


def _duration_to_ms(duration: str | None) -> int | None:
    if not duration:
        return None
    m = re.match(r"^(\d{1,2}):(\d{2})$", duration.strip())
    if not m:
        return None
    mins = int(m.group(1))
    secs = int(m.group(2))
    return (mins * 60 + secs) * 1000


def _extract_first_number(text: str, patterns: list[str], min_value: int = 1) -> int | None:
    for pattern in patterns:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if not m:
            continue
        value = _to_int(m.group(1))
        if value is not None and value >= min_value:
            return value
    return None


def _extract_first_duration_ms(text: str, patterns: list[str]) -> int | None:
    for pattern in patterns:
        m = re.search(pattern, text, flags=re.IGNORECASE)
        if not m:
            continue
        return _duration_to_ms(f"{m.group(1)}:{m.group(2)}")
    return None


def _extract_spotify_ids(hrefs: list[str], item_type: str) -> list[str]:
    ids: list[str] = []
    seen: set[str] = set()
    pattern = re.compile(rf"/{item_type}/([A-Za-z0-9]{{22}})")
    for href in hrefs:
        if not href:
            continue
        match = pattern.search(href)
        if not match:
            continue
        item_id = match.group(1)
        if item_id in seen:
            continue
        seen.add(item_id)
        ids.append(item_id)
    return ids


def _normalize_track_ids(track_ids: list[str] | None) -> list[str]:
    if not track_ids:
        return []
    ids: list[str] = []
    seen: set[str] = set()
    for raw in track_ids:
        if not isinstance(raw, str):
            continue
        sid = raw.strip()
        if not re.fullmatch(r"[A-Za-z0-9]{22}", sid):
            continue
        if sid in seen:
            continue
        seen.add(sid)
        ids.append(sid)
    return ids


def _parse_track_title(title: str) -> str | None:
    # Example: "Final Fantasy - song and lyrics by Drake | Spotify"
    if not title:
        return None
    left = title.split("|", 1)[0].strip()
    marker = " - song and lyrics by "
    if marker in left.lower():
        marker_index = left.lower().find(marker)
        left = left[:marker_index].strip()
    if " - " in left:
        # Spotify titles can be "Artist - Track Name - song and lyrics by Artist".
        # Prefer the trailing segment as track title.
        name = left.rsplit(" - ", 1)[-1].strip()
    else:
        name = left.strip()
    return name or None


def _parse_artist_title(title: str) -> str | None:
    # Example: "Drake | Spotify"
    if not title:
        return None
    name = title.split("|", 1)[0].strip()
    return name or None


def _parse_album_title(title: str) -> tuple[str | None, str | None]:
    # Example: "Scorpion - Album by Drake | Spotify"
    if not title:
        return None, None
    left = title.split("|", 1)[0].strip()
    album_name = left.split(" - Album", 1)[0].strip()
    owner_name = None
    marker = "album by "
    lower_left = left.lower()
    if marker in lower_left:
        marker_index = lower_left.find(marker)
        owner_name = left[marker_index + len(marker):].strip() or None
    return album_name or None, owner_name


async def _ensure_browser() -> Browser:
    global _playwright_instance, _browser
    async with _browser_lock:
        if _browser and _browser.is_connected():
            return _browser

        if _playwright_instance is None:
            _playwright_instance = await async_playwright().start()

        _browser = await _playwright_instance.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage",
            ],
        )
        return _browser


async def _reset_browser() -> None:
    global _browser
    async with _browser_lock:
        if _browser is not None:
            try:
                await _browser.close()
            except Exception:
                pass
            _browser = None


async def _wait_for_spotify_content(page: Page) -> None:
    """
    Wait until Spotify page hydrates enough for scraping.
    Falls back silently when timeout is reached.
    """
    try:
        await page.wait_for_function(
            """
            () => {
                const title = (document.title || "").trim();
                const text = ((document.body && document.body.innerText) || "").toLowerCase();
                if (!text) return false;
                if (text.includes("couldn't find that")) return true;
                if (text.includes("page not found")) return true;
                if (text.includes("monthly listeners")) return true;
                if (text.includes("song and lyrics")) return true;
                if (text.includes("album by")) return true;
                if (document.querySelector("main a[href*='/track/']")) return true;
                return title && title !== "Spotify – Web Player" && !text.includes("loading");
            }
            """,
            timeout=max(2000, settings.PLAYWRIGHT_HYDRATE_TIMEOUT_MS),
        )
    except Exception:
        return


async def _load_page_snapshot(path: str) -> dict[str, Any] | None:
    if not settings.PLAYWRIGHT_ENABLE_FALLBACK:
        return None

    url = f"{SPOTIFY_OPEN}/{path.lstrip('/')}"
    for attempt in range(max(1, settings.PLAYWRIGHT_RETRIES)):
        context = None
        try:
            async with _semaphore:
                browser = await _ensure_browser()
                context = await browser.new_context(
                    locale="en-US",
                    user_agent=_DEFAULT_UA,
                    viewport={"width": 1400, "height": 1000},
                )
                page = await context.new_page()
                await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=settings.PLAYWRIGHT_TIMEOUT_MS,
                )
                await _wait_for_spotify_content(page)
                return {
                    "url": page.url,
                    "title": await page.title(),
                    "text": await page.inner_text("body"),
                }
        except Exception as ex:
            logger.warning("Playwright load failed for %s (attempt %s): %s", url, attempt + 1, ex)
            await _reset_browser()
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass
    return None


async def scrape_track_stats(track_id: str) -> dict[str, Any] | None:
    if track_id in _track_cache:
        return dict(_track_cache[track_id])

    snapshot = await _load_page_snapshot(f"track/{track_id}")
    if not snapshot:
        return None

    title = str(snapshot.get("title") or "").lower()
    raw_title = str(snapshot.get("title") or "")
    text = str(snapshot.get("text") or "")
    if "page not found" in title:
        return None

    playcount = _extract_first_number(
        text,
        patterns=[
            r"\b\d{1,2}:\d{2}\s*[\u2022•]\s*([\d][\d,.\s]{2,}\s*[kKmMbB]?)",
            r"([\d][\d,.\s]{2,}\s*[kKmMbB]?)\s*(?:plays|streams)",
        ],
        min_value=1000,
    )
    duration_ms = _extract_first_duration_ms(
        text,
        patterns=[
            r"[\u2022•]\s*(\d{1,2}):(\d{2})\s*[\u2022•]\s*[\d]",
            r"\b(\d{1,2}):(\d{2})\s*[\u2022•]\s*[\d]",
        ],
    )

    if playcount is None and duration_ms is None:
        return None

    result = {
        "name": _parse_track_title(raw_title),
        "playcount": playcount,
        "duration_ms": duration_ms,
        "crawl_mode": "playwright_track",
    }
    _track_cache[track_id] = dict(result)
    return result


async def scrape_artist_stats(artist_id: str) -> dict[str, Any] | None:
    snapshot = await _load_page_snapshot(f"artist/{artist_id}")
    if not snapshot:
        return None

    title = str(snapshot.get("title") or "").lower()
    raw_title = str(snapshot.get("title") or "")
    text = str(snapshot.get("text") or "")
    if "page not found" in title:
        return None

    monthly_listeners = _extract_first_number(
        text,
        patterns=[r"([\d][\d,.\s]{2,}\s*[kKmMbB]?)\s+monthly listeners"],
        min_value=1000,
    )
    followers = _extract_first_number(
        text,
        patterns=[r"([\d][\d,.\s]{1,}\s*[kKmMbB]?)\s+followers"],
        min_value=1,
    )

    if monthly_listeners is None and followers is None:
        return None

    return {
        "name": _parse_artist_title(raw_title),
        "owner_name": _parse_artist_title(raw_title),
        "monthly_listeners": monthly_listeners,
        "followers": followers,
        "crawl_mode": "playwright_artist",
    }


async def scrape_album_stats(
    album_id: str,
    expected_tracks: int | None = None,
    seed_track_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    if not settings.PLAYWRIGHT_ENABLE_FALLBACK:
        return None

    context = None
    track_ids: list[str] = _normalize_track_ids(seed_track_ids)
    album_name: str | None = None
    owner_name: str | None = None
    if not track_ids:
        try:
            async with _semaphore:
                browser = await _ensure_browser()
                context = await browser.new_context(
                    locale="en-US",
                    user_agent=_DEFAULT_UA,
                    viewport={"width": 1400, "height": 1000},
                )
                page = await context.new_page()
                await page.goto(
                    f"{SPOTIFY_OPEN}/album/{album_id}",
                    wait_until="domcontentloaded",
                    timeout=settings.PLAYWRIGHT_TIMEOUT_MS,
                )
                await _wait_for_spotify_content(page)

                raw_title = str(await page.title())
                if "page not found" in raw_title.lower():
                    return None
                album_name, owner_name = _parse_album_title(raw_title)

                hrefs = await page.eval_on_selector_all(
                    "main [data-testid='tracklist-row'] [data-testid='internal-track-link'][href*='/track/']",
                    "els => els.map(e => e.getAttribute('href') || '')",
                )
                if not hrefs:
                    hrefs = await page.eval_on_selector_all(
                        "main [data-testid='tracklist-row'] a[href*='/track/']",
                        "els => els.map(e => e.getAttribute('href') || '')",
                    )
                if not hrefs:
                    hrefs = await page.eval_on_selector_all(
                        "main [data-testid='internal-track-link'][href*='/track/']",
                        "els => els.map(e => e.getAttribute('href') || '')",
                    )
                if not hrefs:
                    hrefs = await page.eval_on_selector_all(
                        "main a[href*='/track/']",
                        "els => els.map(e => e.getAttribute('href') || '')",
                    )
                track_ids = _extract_spotify_ids(hrefs, "track")
        except Exception as ex:
            logger.warning("Playwright album scrape failed for %s: %s", album_id, ex)
            await _reset_browser()
            return None
        finally:
            if context is not None:
                try:
                    await context.close()
                except Exception:
                    pass

    if not track_ids:
        return None

    max_tracks = max(1, settings.PLAYWRIGHT_ALBUM_MAX_TRACKS)
    track_ids = track_ids[:max_tracks]

    results = await asyncio.gather(
        *(scrape_track_stats(track_id) for track_id in track_ids),
        return_exceptions=True,
    )
    playcounts: list[int] = []
    for row in results:
        if isinstance(row, Exception):
            continue
        if not isinstance(row, dict):
            continue
        value = row.get("playcount")
        if isinstance(value, int):
            playcounts.append(value)

    expected = expected_tracks if isinstance(expected_tracks, int) and expected_tracks > 0 else len(track_ids)
    deep_complete = len(track_ids) >= expected
    full_playcount_coverage = len(playcounts) >= expected
    total_plays = sum(playcounts[:expected]) if deep_complete and full_playcount_coverage else None

    return {
        "name": album_name,
        "owner_name": owner_name,
        "track_count": expected_tracks or len(track_ids),
        "tracks_crawled": len(track_ids),
        "tracks_expected": expected,
        "tracks_with_playcount": len(playcounts),
        "deep_crawl_complete": deep_complete,
        "total_plays": total_plays,
        "playcount": total_plays,
        "crawl_mode": "playwright_album",
    }
