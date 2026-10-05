"""YouTube channel URL parser."""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse


_CHANNEL_ID_RE = re.compile(r"^UC[a-zA-Z0-9_-]{20,}$")


@dataclass(frozen=True)
class ParsedYouTubeChannel:
    query_type: str
    query: str
    url: str


def parse_youtube_channel_url(value: str) -> ParsedYouTubeChannel | None:
    raw = (value or "").strip()
    if not raw:
        return None

    if _CHANNEL_ID_RE.match(raw):
        return ParsedYouTubeChannel("id", raw, f"https://www.youtube.com/channel/{raw}")

    if raw.startswith("@"):
        handle = raw.strip("/")
        return ParsedYouTubeChannel("handle", handle, f"https://www.youtube.com/{handle}")

    parsed = urlparse(raw)
    if not parsed.scheme or not parsed.netloc:
        return None

    host = parsed.netloc.lower()
    if "youtube.com" not in host and "youtu.be" not in host:
        return None

    parts = [part for part in parsed.path.split("/") if part]
    if not parts:
        return None

    first = parts[0]
    if first == "channel" and len(parts) >= 2 and _CHANNEL_ID_RE.match(parts[1]):
        channel_id = parts[1]
        return ParsedYouTubeChannel("id", channel_id, f"https://www.youtube.com/channel/{channel_id}")

    if first.startswith("@"):
        handle = first
        return ParsedYouTubeChannel("handle", handle, f"https://www.youtube.com/{handle}")

    if first == "user" and len(parts) >= 2:
        username = parts[1]
        return ParsedYouTubeChannel("username", username, f"https://www.youtube.com/user/{username}")

    if first == "c" and len(parts) >= 2:
        slug = parts[1]
        return ParsedYouTubeChannel("custom", slug, f"https://www.youtube.com/c/{slug}")

    return None


def build_channel_url(youtube_id: str | None, fallback_url: str | None = None) -> str:
    if youtube_id:
        return f"https://www.youtube.com/channel/{youtube_id}"
    return fallback_url or ""
