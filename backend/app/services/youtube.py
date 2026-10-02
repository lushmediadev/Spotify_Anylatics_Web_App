"""Isolated, bounded YouTube Data API channel requests (no search or DB state)."""

from __future__ import annotations

import logging
from contextvars import ContextVar

import httpx

from app.utils.youtube_urls import parse_youtube_url


YOUTUBE_CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels"
CHANNELS_LIST_BATCH_SIZE = 50
KEY_CHECK_CHANNEL_ID = "UC_x5XG1OV2P6uZZ5FSM9Ttw"
_PRIVATE_HTTP = ContextVar("youtube_private_http", default=False)
_MESSAGES = {
    "no_api_keys": "Channel owner must configure YouTube API keys in their account before refreshing.",
    "invalid_key": "YouTube API key is invalid.",
    "quota_exceeded": "YouTube API quota exhausted.",
    "rate_limited": "YouTube API rate limit reached.",
    "forbidden": "YouTube API access denied.",
    "network_error": "YouTube API connection failed.",
    "api_unavailable": "YouTube API temporarily unavailable.",
    "api_error": "YouTube API request failed.",
    "invalid_response": "YouTube API returned an invalid response.",
    "channel_not_found": "YouTube channel not found.",
    "custom_url_unresolved": "Custom /c/ URLs cannot be resolved; use a channel ID or @handle.",
    "invalid_query": "Invalid YouTube channel query.",
}
_ROTATE = {
    "invalid_key", "quota_exceeded", "rate_limited", "forbidden",
    "network_error", "api_unavailable", "invalid_response",
    "api_error",
}


class _PrivateHTTPFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        return not _PRIVATE_HTTP.get()


_HTTP_FILTER = _PrivateHTTPFilter()


def _install_http_filters() -> None:
    # Logger filters do not propagate to children. Cover httpcore's emitters
    # individually; never change global levels, handlers or other task logs.
    names = {
        "httpx", "httpcore", "httpcore.connection", "httpcore.http11",
        "httpcore.http2", "httpcore.proxy", "httpcore.socks",
    }
    names.update(
        name for name in list(logging.Logger.manager.loggerDict)
        if name.startswith(("httpx.", "httpcore."))
    )
    for name in names:
        logger = logging.getLogger(name)
        if _HTTP_FILTER not in logger.filters:
            logger.addFilter(_HTTP_FILTER)


def _error(code: str) -> dict:
    return {"error_code": code, "error_message": _MESSAGES[code]}


def _clean_key(value: str) -> str:
    if not isinstance(value, str):
        return ""
    key = value.strip()
    # Reject header injection and non-ASCII before passing credentials to httpx.
    return key if key and all(33 <= ord(char) <= 126 for char in key) else ""


def _http_error(response: httpx.Response) -> str:
    reasons = set()
    try:
        payload = response.json()
        detail = payload.get("error", {}) if isinstance(payload, dict) else {}
        if isinstance(detail, dict):
            errors = detail.get("errors", [])
            if isinstance(errors, list):
                reasons = {
                    item["reason"] for item in errors
                    if isinstance(item, dict) and isinstance(item.get("reason"), str)
                }
            details = detail.get("details", [])
            if isinstance(details, list):
                reasons.update(
                    item["reason"] for item in details
                    if isinstance(item, dict) and isinstance(item.get("reason"), str)
                )
    except ValueError:
        pass
    if reasons & {"quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"}:
        return "quota_exceeded"
    if reasons & {"keyInvalid", "authError", "ipRefererBlocked", "accessNotConfigured",
        "API_KEY_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
        "API_KEY_HTTP_REFERRER_BLOCKED", "SERVICE_DISABLED"}:
        return "invalid_key"
    if response.status_code == 429 or reasons & {"rateLimitExceeded", "userRateLimitExceeded"}:
        return "rate_limited"
    if response.status_code == 401:
        return "invalid_key"
    if response.status_code == 403:
        return "forbidden"
    if response.status_code == 404 or "channelNotFound" in reasons:
        return "channel_not_found"
    if response.status_code >= 500:
        return "api_unavailable"
    return "api_error"


async def _request(client: httpx.AsyncClient, key: str, params: dict) -> dict:
    _install_http_filters()
    token = _PRIVATE_HTTP.set(True)
    try:
        # Credentials stay out of URLs; redirects are disabled on our client.
        response = await client.get(
            YOUTUBE_CHANNELS_URL, params=params, headers={"X-Goog-Api-Key": key},
        )
        if response.status_code != 200:
            return _error(_http_error(response))
        try:
            payload = response.json()
        except ValueError:
            return _error("invalid_response")
        if (
            not isinstance(payload, dict)
            or not isinstance(payload.get("items"), list)
            or any(not isinstance(item, dict) for item in payload["items"])
        ):
            return _error("invalid_response")
        return {"items": payload["items"]}
    except httpx.HTTPError:
        return _error("network_error")
    finally:
        _PRIVATE_HTTP.reset(token)


def _channel_result(item: dict) -> dict:
    def obj(value):
        return value if isinstance(value, dict) else {}

    def text(value):
        return value if isinstance(value, str) else None

    if not isinstance(item.get("id"), str) or not item["id"]:
        return _error("invalid_response")
    snippet = obj(item.get("snippet"))
    thumbnails = obj(snippet.get("thumbnails"))
    image = next((
        text(obj(thumbnails.get(size)).get("url"))
        for size in ("high", "medium", "default")
        if text(obj(thumbnails.get(size)).get("url"))
    ), None)
    stats = obj(item.get("statistics"))
    count = stats.get("viewCount")
    try:
        count = int(count) if isinstance(count, (str, int)) and not isinstance(count, bool) else None
        if count is not None and count < 0:
            count = None
    except ValueError:
        count = None
    return {
        "youtube_id": item["id"],
        "name": text(snippet.get("title")),
        "image": image,
        "banner": text(obj(obj(item.get("brandingSettings")).get("image")).get("bannerExternalUrl")),
        "view_count": count,
    }


class _KeyRotation:
    """Failures live only for one fetch, never globally or across callers."""

    def __init__(self, keys: tuple[str, ...]):
        self.keys = keys
        self.disabled: set[int] = set()
        self.cursor = 0
        self.last_error = _error("no_api_keys")

    async def request(self, client: httpx.AsyncClient, params: dict) -> dict:
        for _ in self.keys:
            index = self.cursor
            self.cursor = (self.cursor + 1) % len(self.keys)
            if index in self.disabled:
                continue
            payload = await _request(client, self.keys[index], params)
            code = payload.get("error_code")
            if not code:
                return payload
            if code not in _ROTATE:
                return payload
            self.disabled.add(index)
            self.last_error = payload
        return dict(self.last_error)


class YouTubeClient:
    def __init__(self, keys: list[str]):
        self._keys = tuple(dict.fromkeys(key for value in keys if (key := _clean_key(value))))

    async def fetch_channels(self, queries: list[tuple[str, str]]) -> list[dict]:
        """Return aligned results; accept worker 'channel' as an alias for 'id'."""
        results = [_error("invalid_query") for _ in queries]
        positions: dict[tuple[str, str], list[int]] = {}
        for index, query in enumerate(queries):
            if not isinstance(query, (tuple, list)) or len(query) != 2:
                continue
            kind, value = query
            if not isinstance(kind, str) or not isinstance(value, str):
                continue
            if kind == "channel":
                kind = "id"
            paths = {"id": "channel/", "handle": "", "username": "user/", "custom": "c/"}
            if kind not in paths:
                continue
            if kind == "handle" and not value.startswith("@"):
                value = "@" + value
            canonical = parse_youtube_url("https://www.youtube.com/" + paths[kind] + value)
            if canonical != (kind, value):
                continue
            if kind == "custom":
                results[index] = _error("custom_url_unresolved")
            else:
                positions.setdefault((kind, value), []).append(index)
        if not positions:
            return results
        rotation = _KeyRotation(self._keys)

        def assign(query, result):
            for index in positions[query]:
                results[index] = dict(result)

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            ids = [value for kind, value in positions if kind == "id"]
            for start in range(0, len(ids), CHANNELS_LIST_BATCH_SIZE):
                batch = ids[start:start + CHANNELS_LIST_BATCH_SIZE]
                payload = await rotation.request(client, {
                    "part": "snippet,statistics,brandingSettings",
                    "id": ",".join(batch), "maxResults": 50,
                })
                if "error_code" in payload:
                    for value in batch:
                        assign(("id", value), payload)
                    continue
                by_id = {
                    item["id"]: _channel_result(item) for item in payload["items"]
                    if isinstance(item.get("id"), str)
                }
                for value in batch:
                    assign(("id", value), by_id.get(value, _error("channel_not_found")))
            for query in positions:
                kind, value = query
                if kind == "id":
                    continue
                payload = await rotation.request(client, {
                    "part": "snippet,statistics,brandingSettings", "maxResults": 1,
                    "forHandle" if kind == "handle" else "forUsername": value,
                })
                if "error_code" in payload:
                    result = payload
                else:
                    items = payload["items"]
                    result = _channel_result(items[0]) if items else _error("channel_not_found")
                assign(query, result)
        return results

    @staticmethod
    async def check_keys(keys: list[str]) -> list[dict]:
        return await check_keys(keys)


async def check_keys(keys: list[str]) -> list[dict]:
    """Check each original key independently using a one-unit channels.list call.

    Indices are zero-based. Preview never includes any credential characters.
    Status is valid, invalid, quota_exceeded or error; successful error fields
    are None. No key rotation is used during validation.
    """
    results = []
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
        for index, value in enumerate(keys):
            key = _clean_key(value)
            payload = await _request(client, key, {
                "part": "id", "id": KEY_CHECK_CHANNEL_ID, "maxResults": 1,
            }) if key else _error("invalid_key")
            code = payload.get("error_code")
            status = "valid" if code is None else {
                "invalid_key": "invalid", "forbidden": "invalid",
                "quota_exceeded": "quota_exceeded",
            }.get(code, "error")
            results.append({
                "index": index, "preview": "[redacted]", "status": status,
                "error_code": code, "error_message": payload.get("error_message"),
            })
    return results
