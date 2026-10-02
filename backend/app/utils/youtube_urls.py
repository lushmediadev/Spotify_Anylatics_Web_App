"""Parse channel identities without resolving ambiguous custom URLs."""

from __future__ import annotations

import re
from urllib.parse import unquote, urlsplit


_CHANNEL_ID = re.compile(r"UC[A-Za-z0-9_-]{22}\Z")
_NAME = re.compile(r"[\w.-]{1,100}\Z", re.UNICODE)
_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}
_TABS = {"featured", "videos", "shorts", "streams", "playlists", "community", "about"}


def parse_youtube_url(url: str) -> tuple[str, str] | None:
    """Return id/handle/username/custom and query; custom remains unresolved.

    Bare channel IDs and @handles are also accepted. Video URLs, lookalike
    hosts, credentials, non-HTTP schemes and unknown channel subpaths are not.
    """
    if not isinstance(url, str):
        return None
    value = url.strip()
    if not value or "\\" in value or any(ord(char) < 32 or ord(char) == 127 for char in value):
        return None
    if _CHANNEL_ID.fullmatch(value):
        return "id", value
    if value.startswith("@") and _NAME.fullmatch(value[1:]):
        return "handle", value
    try:
        parsed = urlsplit(value)
        if (
            parsed.scheme not in {"http", "https"}
            or parsed.hostname not in _HOSTS
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in {None, 443 if parsed.scheme == "https" else 80}
        ):
            return None
        path = unquote(parsed.path, errors="strict")
    except (ValueError, UnicodeError):
        return None
    parts = path.removeprefix("/").removesuffix("/").split("/")
    if parts[0].startswith("@"):
        kind, query, tail = "handle", parts[0], parts[1:]
        if not _NAME.fullmatch(query[1:]):
            return None
    elif len(parts) >= 2 and parts[0] in {"channel", "user", "c"}:
        kind = {"channel": "id", "user": "username", "c": "custom"}[parts[0]]
        query, tail = parts[1], parts[2:]
        if not (_CHANNEL_ID if kind == "id" else _NAME).fullmatch(query):
            return None
    else:
        return None
    if tail and (len(tail) != 1 or tail[0] not in _TABS):
        return None
    return kind, query
