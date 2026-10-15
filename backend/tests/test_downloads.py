from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlparse
import asyncio
import os
import uuid

from fastapi import HTTPException
from fastapi.responses import FileResponse
import pytest

from app.api import downloads as downloads_api
from app.services.auth import create_access_token


class _Result:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class _Db:
    def __init__(self, user):
        self.user = user

    async def execute(self, _query):
        return _Result(self.user)


@pytest.fixture
def downloads_dir(tmp_path, monkeypatch):
    (tmp_path / "MusicMix-Setup-1.0.0.rar").write_bytes(b"x" * 2048)
    (tmp_path / ".hidden").write_text("secret")
    (tmp_path / "nested").mkdir()
    monkeypatch.setattr(downloads_api.settings, "DOWNLOADS_DIR", str(tmp_path))
    return tmp_path


def _admin(role="admin", active=True):
    return SimpleNamespace(id=uuid.uuid4(), role=role, is_active=active)


def _token_from(url):
    return unquote(parse_qs(urlparse(url).query)["token"][0])


def test_list_shows_only_visible_files(downloads_dir):
    data = asyncio.run(downloads_api.list_downloads(_admin()))
    assert [f["name"] for f in data["files"]] == ["MusicMix-Setup-1.0.0.rar"]
    assert data["files"][0]["size"] == 2048


def test_list_is_empty_without_directory(monkeypatch):
    monkeypatch.setattr(downloads_api.settings, "DOWNLOADS_DIR", "")
    assert asyncio.run(downloads_api.list_downloads(_admin())) == {"files": []}


@pytest.mark.parametrize("name", ["../etc/passwd", ".hidden", "nested", "missing.rar", ""])
def test_link_rejects_unsafe_or_missing_names(downloads_dir, name):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(downloads_api.create_download_link(name, _admin()))
    assert exc.value.status_code == 404


def test_signed_link_downloads_file(downloads_dir):
    admin = _admin()
    link = asyncio.run(downloads_api.create_download_link("MusicMix-Setup-1.0.0.rar", admin))
    response = asyncio.run(downloads_api.download_file("MusicMix-Setup-1.0.0.rar", _token_from(link["url"]), _Db(admin)))
    assert isinstance(response, FileResponse)
    assert response.headers["cache-control"] == "private, no-store"
    assert "attachment" in response.headers["content-disposition"]


def test_link_token_is_bound_to_file_and_admin(downloads_dir):
    admin = _admin()
    token = _token_from(asyncio.run(downloads_api.create_download_link("MusicMix-Setup-1.0.0.rar", admin))["url"])
    with pytest.raises(HTTPException) as other_file:
        asyncio.run(downloads_api.download_file("other.rar", token, _Db(admin)))
    assert other_file.value.status_code == 403
    for user in (None, _admin(role="manager"), _admin(active=False)):
        with pytest.raises(HTTPException) as denied:
            asyncio.run(downloads_api.download_file("MusicMix-Setup-1.0.0.rar", token, _Db(user)))
        assert denied.value.status_code == 403


def test_access_tokens_and_expired_links_are_rejected(downloads_dir):
    admin = _admin()
    access = create_access_token({"sub": str(admin.id)})
    expired = create_access_token(
        {"purpose": "download", "uid": str(admin.id), "file": "MusicMix-Setup-1.0.0.rar"},
        expires_delta=timedelta(seconds=-5),
    )
    for token in (access, expired, "garbage"):
        with pytest.raises(HTTPException) as exc:
            asyncio.run(downloads_api.download_file("MusicMix-Setup-1.0.0.rar", token, _Db(admin)))
        assert exc.value.status_code == 403


class _Body:
    """Stand-in for a Starlette Request whose body arrives in pieces."""

    def __init__(self, data, piece=4096):
        self._pieces = [data[i:i + piece] for i in range(0, len(data), piece)] or [b""]

    async def stream(self):
        for piece in self._pieces:
            yield piece


def _start(admin, name="New-Setup.rar", size=10, overwrite=False):
    body = downloads_api.UploadStart(name=name, size=size, overwrite=overwrite)
    return asyncio.run(downloads_api.start_upload(body, admin))["upload_id"]


def _put(upload_id, admin, data, offset):
    return asyncio.run(downloads_api.upload_chunk(upload_id, _Body(data), offset, admin))


def _status(call):
    with pytest.raises(HTTPException) as exc:
        call()
    return exc.value.status_code


def test_chunked_upload_lands_in_downloads(downloads_dir):
    admin = _admin()
    payload = bytes(range(256)) * 40
    upload_id = _start(admin, size=len(payload))
    assert _put(upload_id, admin, payload[:6000], 0)["received"] == 6000
    assert _put(upload_id, admin, payload[6000:], 6000)["received"] == len(payload)
    info = asyncio.run(downloads_api.complete_upload(upload_id, admin))
    assert info["name"] == "New-Setup.rar" and info["size"] == len(payload)
    assert (downloads_dir / "New-Setup.rar").read_bytes() == payload
    assert list((downloads_dir / ".uploads").iterdir()) == []
    names = [f["name"] for f in asyncio.run(downloads_api.list_downloads(admin))["files"]]
    assert names == ["MusicMix-Setup-1.0.0.rar", "New-Setup.rar"]


def test_chunks_must_arrive_in_order(downloads_dir):
    admin = _admin()
    upload_id = _start(admin, size=10)
    with pytest.raises(HTTPException) as skipped:
        _put(upload_id, admin, b"bbbbb", 5)
    assert skipped.value.status_code == 409 and skipped.value.detail["received"] == 0
    _put(upload_id, admin, b"aaaaa", 0)
    assert _status(lambda: _put(upload_id, admin, b"aaaaa", 0)) == 409
    assert _status(lambda: asyncio.run(downloads_api.complete_upload(upload_id, admin))) == 409
    _put(upload_id, admin, b"bbbbb", 5)
    asyncio.run(downloads_api.complete_upload(upload_id, admin))
    assert (downloads_dir / "New-Setup.rar").read_bytes() == b"aaaaabbbbb"


def test_size_limits(downloads_dir, monkeypatch):
    admin = _admin()
    assert _status(lambda: _start(admin, size=0)) == 400
    assert _status(lambda: _start(admin, size=downloads_api.MAX_UPLOAD_BYTES + 1)) == 413
    upload_id = _start(admin, size=10)
    # More bytes than the declared file size are rejected and the chunk is rolled back.
    assert _status(lambda: _put(upload_id, admin, b"x" * 11, 0)) == 413
    monkeypatch.setattr(downloads_api, "MAX_CHUNK_BYTES", 4)
    assert _status(lambda: _put(upload_id, admin, b"x" * 5, 0)) == 413
    assert (downloads_dir / ".uploads" / f"{upload_id}.part").stat().st_size == 0
    assert _put(upload_id, admin, b"x" * 4, 0)["received"] == 4


@pytest.mark.parametrize("name", ["../evil.rar", "a/b.rar", "a\b.rar", ".hidden", ".uploads", "", "  ", "bad\nname"])
def test_upload_rejects_unsafe_names(downloads_dir, name):
    assert _status(lambda: _start(_admin(), name=name)) == 400


def test_upload_refuses_to_overwrite_unless_asked(downloads_dir):
    admin = _admin()
    existing = "MusicMix-Setup-1.0.0.rar"
    assert _status(lambda: _start(admin, name=existing)) == 409
    assert _status(lambda: _start(admin, name="nested", overwrite=True)) == 409
    upload_id = _start(admin, name=existing, size=3, overwrite=True)
    _put(upload_id, admin, b"new", 0)
    asyncio.run(downloads_api.complete_upload(upload_id, admin))
    assert (downloads_dir / existing).read_bytes() == b"new"


def test_upload_created_meanwhile_is_not_overwritten(downloads_dir):
    admin = _admin()
    upload_id = _start(admin, size=3)
    _put(upload_id, admin, b"abc", 0)
    (downloads_dir / "New-Setup.rar").write_bytes(b"other")
    assert _status(lambda: asyncio.run(downloads_api.complete_upload(upload_id, admin))) == 409
    assert (downloads_dir / "New-Setup.rar").read_bytes() == b"other"


def test_upload_is_bound_to_its_admin_and_id_format(downloads_dir):
    owner = _admin()
    upload_id = _start(owner)
    assert _status(lambda: _put(upload_id, _admin(), b"x", 0)) == 404
    for bad in ("../../etc", "0" * 31, "Z" * 32):
        assert _status(lambda: _put(bad, owner, b"x", 0)) == 404


def test_abort_and_stale_cleanup(downloads_dir):
    admin = _admin()
    upload_id = _start(admin)
    asyncio.run(downloads_api.abort_upload(upload_id, admin))
    assert list((downloads_dir / ".uploads").iterdir()) == []
    stale = downloads_dir / ".uploads" / ("a" * 32 + ".part")
    stale.write_bytes(b"old")
    old = stale.stat().st_mtime - downloads_api._STALE_UPLOAD_SECONDS - 60
    os.utime(stale, (old, old))
    _start(admin)
    assert not stale.exists()


def test_upload_needs_configured_directory(monkeypatch):
    monkeypatch.setattr(downloads_api.settings, "DOWNLOADS_DIR", "")
    assert _status(lambda: _start(_admin())) == 503


def test_delete_removes_file(downloads_dir):
    admin = _admin()
    assert asyncio.run(downloads_api.delete_download("MusicMix-Setup-1.0.0.rar", admin)) == {"deleted": "MusicMix-Setup-1.0.0.rar"}
    assert not (downloads_dir / "MusicMix-Setup-1.0.0.rar").exists()
    for name in ("../etc/passwd", ".hidden", "nested", "missing.rar"):
        assert _status(lambda: asyncio.run(downloads_api.delete_download(name, admin))) == 404
    assert (downloads_dir / ".hidden").exists()


def test_write_endpoints_require_admin():
    from app.services.auth import get_admin_user

    guarded = {
        (method, route.path)
        for route in downloads_api.router.routes
        for method in route.methods
        if any(dep.call is get_admin_user for dep in route.dependant.dependencies)
    }
    for expected in [
        ("PATCH", "/downloads/{name}"),
        ("DELETE", "/downloads/{name}"),
        ("POST", "/downloads/uploads"),
        ("PUT", "/downloads/uploads/{upload_id}"),
        ("POST", "/downloads/uploads/{upload_id}/complete"),
        ("DELETE", "/downloads/uploads/{upload_id}"),
    ]:
        assert expected in guarded
    with pytest.raises(HTTPException) as exc:
        asyncio.run(get_admin_user(_admin(role="manager")))
    assert exc.value.status_code == 403


def test_title_is_persisted_without_renaming_or_exposing_metadata(downloads_dir):
    admin = _admin()
    name = "MusicMix-Setup-1.0.0.rar"
    body = downloads_api.UpdateDownloadTitle(title="  MusicMix Desktop  ")
    saved = asyncio.run(downloads_api.update_download_title(name, body, admin))
    assert saved["title"] == "MusicMix Desktop"
    assert saved["name"] == name
    assert (downloads_dir / name).read_bytes() == b"x" * 2048
    listing = asyncio.run(downloads_api.list_downloads(admin))["files"]
    assert len(listing) == 1 and listing[0]["title"] == "MusicMix Desktop"
    assert _status(lambda: asyncio.run(downloads_api.create_download_link(".downloads.json", admin))) == 404


def test_replace_preserves_title_until_completed(downloads_dir):
    admin = _admin()
    name = "MusicMix-Setup-1.0.0.rar"
    asyncio.run(downloads_api.update_download_title(name, downloads_api.UpdateDownloadTitle(title="Desktop app"), admin))
    upload_id = _start(admin, name=name, size=3, overwrite=True)
    _put(upload_id, admin, b"new", 0)
    assert (downloads_dir / name).read_bytes() == b"x" * 2048
    result = asyncio.run(downloads_api.complete_upload(upload_id, admin))
    assert result["name"] == name and result["title"] == "Desktop app"
    assert (downloads_dir / name).read_bytes() == b"new"


def test_new_upload_can_set_title(downloads_dir):
    admin = _admin()
    body = downloads_api.UploadStart(name="new.zip", size=3, title="New tool")
    upload_id = asyncio.run(downloads_api.start_upload(body, admin))["upload_id"]
    _put(upload_id, admin, b"zip", 0)
    result = asyncio.run(downloads_api.complete_upload(upload_id, admin))
    assert result["title"] == "New tool"
    assert [f for f in asyncio.run(downloads_api.list_downloads(admin))["files"] if f["name"] == "new.zip"][0]["title"] == "New tool"


@pytest.mark.parametrize("title", ["  ", "bad\ntitle"])
def test_invalid_title_is_rejected(downloads_dir, title):
    body = downloads_api.UpdateDownloadTitle(title=title)
    assert _status(lambda: asyncio.run(downloads_api.update_download_title("MusicMix-Setup-1.0.0.rar", body, _admin()))) == 400
