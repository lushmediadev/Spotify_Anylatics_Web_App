import asyncio
import json
import logging

import httpx
import pytest

from app.services import youtube
from app.utils.youtube_urls import parse_youtube_url


CHANNEL_ID = youtube.KEY_CHECK_CHANNEL_ID


def channel(channel_id=CHANNEL_ID, **overrides):
    return {
        "id": channel_id,
        "snippet": {"title": "Channel", "thumbnails": {"high": {"url": "https://img/high"}}},
        "brandingSettings": {"image": {"bannerExternalUrl": "https://img/banner"}},
        "statistics": {"viewCount": "12345678901234567890"},
        **overrides,
    }


def mock_http(monkeypatch, handler):
    real_client = httpx.AsyncClient
    requests = []
    clients = []

    def transport(request):
        requests.append(request)
        assert request.url.path == "/youtube/v3/channels"
        assert "key" not in request.url.params
        return handler(request)

    def factory(**kwargs):
        client = real_client(transport=httpx.MockTransport(transport), **kwargs)
        clients.append(client)
        return client

    monkeypatch.setattr(youtube.httpx, "AsyncClient", factory)
    return requests, clients


def api_error(reason, status=403, secret="private-key"):
    return httpx.Response(status, json={"error": {
        "message": f"Unsafe message {secret}",
        "errors": [{"reason": reason, "message": secret}],
    }})


@pytest.mark.parametrize("url,expected", [
    (CHANNEL_ID, ("id", CHANNEL_ID)),
    ("@Example", ("handle", "@Example")),
    (f"https://www.youtube.com/channel/{CHANNEL_ID}", ("id", CHANNEL_ID)),
    ("https://youtube.com/@Example/", ("handle", "@Example")),
    ("https://m.youtube.com/@Example/videos?view=0#top", ("handle", "@Example")),
    ("https://music.youtube.com/%40Example", ("handle", "@Example")),
    ("https://YOUTUBE.COM/user/Legacy/about", ("username", "Legacy")),
    ("http://youtube.com/c/Custom", ("custom", "Custom")),
    ("https://youtube.com/@%E6%97%A5%E6%9C%AC", ("handle", "@\u65e5\u672c")),
])
def test_parser_supported(url, expected):
    assert parse_youtube_url(url) == expected


@pytest.mark.parametrize("url", [
    None, "", "https://youtube.com", "youtube.com/@Example",
    "https://notyoutube.com/@Example", "https://youtube.com.evil.test/@Example",
    "https://evil.test/youtube.com/@Example", "https://youtube.com@evil.test/@Example",
    "https://user:pass@youtube.com/@Example", "https://youtu.be/abc123",
    "https://youtube.com/watch?v=abc", "https://youtube.com/shorts/abc",
    "https://youtube.com/playlist?list=abc", "https://youtube.com/Example",
    "ftp://youtube.com/@Example", "https://youtube.com:444/@Example",
    "https://youtube.com:bad/@Example", "https://youtube.com./@Example",
    "https://youtube.com/@Example/unknown", "https://youtube.com/@Example/videos/extra",
    "https://youtube.com//user/Example", "https://youtube.com/user/",
    "https://youtube.com/@", "https://youtube.com/@bad%2Fname",
    "https://youtube.com/@bad%20name", "https://youtube.com/@bad%0Aname",
    "https://youtube.com/@bad%FFname", "https://youtube.com\\evil.test/@Example",
    "https://youtube.com/\n@Example", "UCshort", f"{CHANNEL_ID}extra",
    f"https://youtube.com/channel/{CHANNEL_ID}extra",
])
def test_parser_rejected(url):
    assert parse_youtube_url(url) is None


def test_batch_50_order_duplicates_and_missing(monkeypatch):
    ids = ["UC" + f"{index:022d}" for index in range(101)]

    def handler(request):
        batch = request.url.params["id"].split(",")
        assert len(batch) <= 50
        assert request.url.params["maxResults"] == "50"
        return httpx.Response(200, json={"items": [channel(value) for value in reversed(batch) if value != ids[4]]})

    requests, clients = mock_http(monkeypatch, handler)
    queries = [("id", value) for value in ids] + [("id", ids[0])]
    results = asyncio.run(youtube.YouTubeClient(["key"]).fetch_channels(queries))
    assert len(results) == len(queries)
    assert len(requests) == 3
    assert results[4]["error_code"] == "channel_not_found"
    for index, value in enumerate(ids):
        if index != 4:
            assert results[index]["youtube_id"] == value
    assert results[-1] == results[0]
    assert results[-1] is not results[0]
    assert all(client.is_closed for client in clients)
    assert results[0] == {
        "youtube_id": ids[0], "name": "Channel", "image": "https://img/high",
        "banner": "https://img/banner", "view_count": 12345678901234567890,
    }


def test_handle_username_custom_and_invalid_alignment(monkeypatch):
    def handler(request):
        assert "id" not in request.url.params
        assert "q" not in request.url.params
        return httpx.Response(200, json={"items": [] if "forUsername" in request.url.params else [channel()]})

    requests, _ = mock_http(monkeypatch, handler)
    results = asyncio.run(youtube.YouTubeClient(["key"]).fetch_channels([
        ("custom", "Custom"), ("handle", "Example"), ("username", "Legacy"),
        ("handle", "@Example"), ("search", "no"), ("id", "bad"),
        ("handle", "@Example?secret=oops"), ("id", []), None,
    ]))
    assert len(results) == 9
    assert results[0]["error_code"] == "custom_url_unresolved"
    assert results[1]["youtube_id"] == CHANNEL_ID
    assert results[2]["error_code"] == "channel_not_found"
    assert results[3] == results[1]
    assert all(result["error_code"] == "invalid_query" for result in results[4:])
    assert len(requests) == 2
    assert requests[0].url.params["forHandle"] == "@Example"
    assert requests[1].url.params["forUsername"] == "Legacy"


def test_empty_and_no_keys_do_not_request(monkeypatch):
    def handler(request):
        pytest.fail("No HTTP request expected")

    requests, _ = mock_http(monkeypatch, handler)
    assert asyncio.run(youtube.YouTubeClient([]).fetch_channels([])) == []
    results = asyncio.run(youtube.YouTubeClient(["", " ", "bad\nkey"]).fetch_channels([
        ("id", CHANNEL_ID), ("custom", "Custom"), ("bad", "query"),
    ]))
    assert [item["error_code"] for item in results] == [
        "no_api_keys", "custom_url_unresolved", "invalid_query",
    ]
    assert requests == []


def test_worker_channel_alias_and_actionable_no_keys(monkeypatch):
    requests, _ = mock_http(monkeypatch, lambda request: httpx.Response(200, json={"items": [channel()]}))
    queries = [("channel", CHANNEL_ID), ("id", CHANNEL_ID)]
    results = asyncio.run(youtube.YouTubeClient(["key"]).fetch_channels(queries))
    assert results[0] == results[1]
    assert results[0]["youtube_id"] == CHANNEL_ID
    assert len(requests) == 1
    assert requests[0].url.params["id"] == CHANNEL_ID
    errors = asyncio.run(youtube.YouTubeClient([]).fetch_channels(queries))
    assert all(row["error_code"] == "no_api_keys" for row in errors)
    assert all(row["error_message"] == "Channel owner must configure YouTube API keys in their account before refreshing." for row in errors)
    assert len(requests) == 1


@pytest.mark.parametrize("failure,code", [
    ("quotaExceeded", "quota_exceeded"), ("keyInvalid", "invalid_key"),
    ("rateLimitExceeded", "rate_limited"), ("accessNotConfigured", "invalid_key"),
    ("unknown-private-key", "forbidden"),
])
def test_rotation_scoped_to_fetch(monkeypatch, failure, code):
    def handler(request):
        if request.headers["x-goog-api-key"] == "bad-key":
            return api_error(failure)
        return httpx.Response(200, json={"items": [channel()]})

    requests, _ = mock_http(monkeypatch, handler)
    client = youtube.YouTubeClient(["bad-key", "good-key", "good-key"])
    queries = [("handle", "@One"), ("username", "Two")]
    first = asyncio.run(client.fetch_channels(queries))
    second = asyncio.run(client.fetch_channels(queries))
    assert all(item["youtube_id"] == CHANNEL_ID for item in first + second)
    assert [request.headers["x-goog-api-key"] for request in requests] == [
        "bad-key", "good-key", "good-key", "bad-key", "good-key", "good-key",
    ]
    assert code not in json.dumps(first)


def test_exhaustion_bounded_and_safe(monkeypatch):
    requests, _ = mock_http(monkeypatch, lambda request: api_error("quotaExceeded", secret="secret-key"))
    results = asyncio.run(youtube.YouTubeClient(["secret-key", "other-key"]).fetch_channels([
        ("handle", "@One"), ("username", "Two"), ("id", CHANNEL_ID),
    ]))
    assert len(requests) == 2
    assert all(result == youtube._error("quota_exceeded") for result in results)
    assert "secret-key" not in json.dumps(results)


@pytest.mark.parametrize("response,code", [
    (httpx.Response(500, text="private-key"), "api_unavailable"),
    (httpx.Response(429, text="private-key"), "rate_limited"),
    (httpx.Response(401, text="private-key"), "invalid_key"),
    (httpx.Response(400, json={"error": ["private-key"]}), "api_error"),
    (httpx.Response(404, text="private-key"), "channel_not_found"),
    (httpx.Response(302, headers={"location": "https://evil.test/private-key"}), "api_error"),
    (httpx.Response(200, text="private-key"), "invalid_response"),
    (httpx.Response(200, json=[]), "invalid_response"),
    (httpx.Response(200, json={"items": None}), "invalid_response"),
    (httpx.Response(200, json={"items": [None]}), "invalid_response"),
    (httpx.Response(200, json={"items": [{"snippet": {}}]}), "invalid_response"),
])
def test_safe_failures(monkeypatch, response, code):
    requests, _ = mock_http(monkeypatch, lambda request: response)
    results = asyncio.run(youtube.YouTubeClient(["private-key"]).fetch_channels([("handle", "@One")]))
    assert results == [youtube._error(code)]
    assert len(requests) == 1
    assert "private-key" not in json.dumps(results)


def test_network_failure_rotates_and_does_not_echo_exception(monkeypatch):
    def handler(request):
        if request.headers["x-goog-api-key"] == "private-key":
            raise httpx.ConnectError("private-key https://example.test/?key=private-key", request=request)
        return httpx.Response(200, json={"items": [channel()]})

    requests, _ = mock_http(monkeypatch, handler)
    result = asyncio.run(youtube.YouTubeClient(["private-key", "good-key"]).fetch_channels([("id", CHANNEL_ID)]))
    assert result[0]["youtube_id"] == CHANNEL_ID
    assert len(requests) == 2


@pytest.mark.parametrize("stats,expected", [
    ({}, None), ({"viewCount": "0"}, 0), ({"viewCount": "bad"}, None),
    ({"viewCount": None}, None), ({"viewCount": -1}, None), ({"viewCount": True}, None),
])
def test_metadata_fallback(monkeypatch, stats, expected):
    item = channel(snippet={"thumbnails": {"high": {}, "medium": {"url": "medium"}}},
                   brandingSettings=None, statistics=stats)
    mock_http(monkeypatch, lambda request: httpx.Response(200, json={"items": [item]}))
    result = asyncio.run(youtube.YouTubeClient(["key"]).fetch_channels([("id", CHANNEL_ID)]))[0]
    assert result["view_count"] == expected
    assert result["image"] == "medium"
    assert result["banner"] is None
    assert result["name"] is None


def test_check_keys_cheap_independent_and_redacted(monkeypatch):
    def handler(request):
        assert dict(request.url.params) == {"part": "id", "id": CHANNEL_ID, "maxResults": "1"}
        key = request.headers["x-goog-api-key"]
        if key == "quota-key":
            return api_error("quotaExceeded", secret=key)
        if key == "invalid-key":
            return api_error("keyInvalid", status=400, secret=key)
        if key == "broken-key":
            raise httpx.ReadTimeout(key, request=request)
        return httpx.Response(200, json={"items": [{"id": CHANNEL_ID}],
                                       "error_code": "secret", "error_message": key})

    requests, clients = mock_http(monkeypatch, handler)
    keys = ["valid-key", "quota-key", "invalid-key", "broken-key", "", "x", "bad\r\nkey", "valid-key"]
    results = asyncio.run(youtube.check_keys(keys))
    assert [row["index"] for row in results] == list(range(len(keys)))
    assert [row["status"] for row in results] == [
        "valid", "quota_exceeded", "invalid", "error", "invalid", "valid", "invalid", "valid",
    ]
    assert len(requests) == 6
    for row in results:
        assert set(row) == {"index", "preview", "status", "error_code", "error_message"}
        assert row["preview"] == "[redacted]"
        assert row["error_code"] is None or isinstance(row["error_code"], str)
    assert results[0]["error_message"] is None
    serialized = json.dumps(results)
    assert all(key not in serialized for key in keys if len(key) > 1)
    assert all(client.is_closed for client in clients)
    assert asyncio.run(youtube.YouTubeClient.check_keys([])) == []


def test_private_http_logging_is_task_scoped_and_restored(monkeypatch, caplog):
    real_client = httpx.AsyncClient
    entered = asyncio.Event()
    proceed = asyncio.Event()
    loggers = [logging.getLogger(name) for name in ("httpx", "httpcore.http11", "httpcore.http2")]
    levels = [logger.level for logger in loggers]

    async def handler(request):
        for logger in loggers:
            logger.warning("private-key raw headers and URL")
        entered.set()
        await proceed.wait()
        return httpx.Response(200, json={"items": []})

    monkeypatch.setattr(youtube.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(handler), **kwargs,
    ))

    async def run():
        task = asyncio.create_task(youtube.YouTubeClient(["private-key"]).fetch_channels([("id", CHANNEL_ID)]))
        await entered.wait()
        for logger in loggers:
            logger.warning("unrelated concurrent traffic")
        proceed.set()
        await task
        for logger in loggers:
            logger.warning("unrelated traffic after request")

    with caplog.at_level(logging.DEBUG):
        asyncio.run(run())
    assert "private-key" not in caplog.text
    assert caplog.text.count("unrelated concurrent traffic") == len(loggers)
    assert caplog.text.count("unrelated traffic after request") == len(loggers)
    assert [logger.level for logger in loggers] == levels


def test_cancellation_propagates_and_logging_context_resets(monkeypatch):
    def handler(request):
        raise asyncio.CancelledError()

    mock_http(monkeypatch, handler)

    async def run():
        with pytest.raises(asyncio.CancelledError):
            await youtube.YouTubeClient(["key"]).fetch_channels([("id", CHANNEL_ID)])
        assert youtube._PRIVATE_HTTP.get() is False

    asyncio.run(run())


def test_quota_and_key_checks_never_log_credentials(monkeypatch, caplog):
    secret = "AIza-private-credential"

    def handler(request):
        logging.getLogger("httpcore.http11").warning(
            "Unsafe request %s headers=%s", request.url, request.headers,
        )
        return api_error("quotaExceeded", secret=secret)

    requests, _ = mock_http(monkeypatch, handler)
    with caplog.at_level(logging.DEBUG):
        fetched = asyncio.run(youtube.YouTubeClient([secret]).fetch_channels([("id", CHANNEL_ID)]))
        checked = asyncio.run(youtube.check_keys([secret]))
        logging.getLogger("httpx").warning("Other traffic remains observable")
    assert fetched == [youtube._error("quota_exceeded")]
    assert checked == [{
        "index": 0, "preview": "[redacted]", "status": "quota_exceeded",
        **youtube._error("quota_exceeded"),
    }]
    assert secret not in json.dumps(fetched + checked)
    assert secret not in caplog.text
    assert "Unsafe request" not in caplog.text
    assert "Other traffic remains observable" in caplog.text
    assert all(secret not in str(request.url) for request in requests)


def structured_invalid_key_response(secret):
    return httpx.Response(400, json={"error": {
        "code": 400,
        "status": "INVALID_ARGUMENT",
        "message": f"Untrusted localized diagnostic {secret}",
        "errors": [{"reason": "badRequest", "message": secret}],
        "details": [{
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            "reason": "API_KEY_INVALID", "domain": "googleapis.com",
            "metadata": {"service": "youtube.googleapis.com", "unsafe": secret},
        }],
    }})


def test_check_keys_recognizes_structured_invalid_key_without_echo(monkeypatch, caplog):
    secret = "AIza-regression-invalid-credential"
    requests, _ = mock_http(monkeypatch, lambda request: structured_invalid_key_response(secret))
    with caplog.at_level(logging.DEBUG):
        results = asyncio.run(youtube.check_keys([secret]))
    assert secret not in json.dumps(results)
    assert secret not in caplog.text
    assert secret not in str(requests[0].url)
    assert results == [{
        "index": 0, "preview": "[redacted]", "status": "invalid",
        "error_code": "invalid_key", "error_message": "YouTube API key is invalid.",
    }]


def test_fetch_rotates_structured_invalid_key_and_disables_it_for_batch(monkeypatch, caplog):
    secret = "AIza-regression-invalid-credential"

    def handler(request):
        if request.headers["x-goog-api-key"] == secret:
            return structured_invalid_key_response(secret)
        return httpx.Response(200, json={"items": [channel()]})

    requests, _ = mock_http(monkeypatch, handler)
    with caplog.at_level(logging.DEBUG):
        results = asyncio.run(youtube.YouTubeClient([secret, "valid-key"]).fetch_channels([
            ("id", CHANNEL_ID), ("handle", "@Example"),
        ]))
    assert secret not in json.dumps(results)
    assert secret not in caplog.text
    assert all(secret not in str(request.url) for request in requests)
    assert all(result.get("youtube_id") == CHANNEL_ID for result in results)
    assert [request.headers["x-goog-api-key"] for request in requests] == [
        secret, "valid-key", "valid-key",
    ]


@pytest.mark.parametrize("details", [
    None, [], "API_KEY_INVALID", [None, "API_KEY_INVALID"],
    [{"@type": "type.googleapis.com/google.rpc.LocalizedMessage",
      "message": "API_KEY_INVALID"}],
])
def test_generic_bad_request_rotates_without_message_based_classification(monkeypatch, details):
    def handler(request):
        return httpx.Response(400, json={"error": {
            "status": "INVALID_ARGUMENT", "message": "API key not valid. API_KEY_INVALID",
            "errors": [{"reason": "badRequest"}], "details": details,
        }})

    requests, _ = mock_http(monkeypatch, handler)
    results = asyncio.run(youtube.YouTubeClient(["first-key", "second-key"]).fetch_channels([
        ("id", CHANNEL_ID),
    ]))
    assert results == [{"error_code": "api_error", "error_message": "YouTube API request failed."}]
    assert [request.headers["x-goog-api-key"] for request in requests] == ["first-key", "second-key"]
    checked = asyncio.run(youtube.check_keys(["first-key"]))
    assert checked[0]["status"] == "error"
    assert checked[0]["error_code"] == "api_error"
    assert checked[0]["error_message"] == "YouTube API request failed."


def test_generic_400_recovers_using_next_key(monkeypatch):
    def handler(request):
        if request.headers["x-goog-api-key"] == "first-key":
            return httpx.Response(400, json={"error": {
                "errors": [{"reason": "badRequest"}], "message": "Untrusted diagnostic",
            }})
        return httpx.Response(200, json={"items": [channel()]})

    requests, _ = mock_http(monkeypatch, handler)
    results = asyncio.run(youtube.YouTubeClient(["first-key", "second-key"]).fetch_channels([
        ("id", CHANNEL_ID),
    ]))
    assert results[0]["youtube_id"] == CHANNEL_ID
    assert [request.headers["x-goog-api-key"] for request in requests] == ["first-key", "second-key"]
