from datetime import timedelta
from types import SimpleNamespace
from urllib.parse import parse_qs, unquote, urlparse
import asyncio
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
