import uuid
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from app.api import crawl as crawl_api
from app.models.item import Item
from app.services.crawler import _formatted_item_name
from app.services.spotify_client import _format_album_display_name
from app.services.spotify_web_scraper import _parse_track_title


class _FakeAsyncDb:
    def __init__(self, duplicates):
        self._duplicates = list(duplicates)
        self.add_calls = []
        self.execute = AsyncMock(
            return_value=SimpleNamespace(
                scalars=lambda: SimpleNamespace(all=lambda: self._duplicates)
            )
        )
        self.flush = AsyncMock()

    def add(self, item):
        self.add_calls.append(item)


class AlbumNamingTests(unittest.TestCase):
    def test_format_album_display_name_includes_all_artists(self):
        result = _format_album_display_name(
            "Random Access Memories",
            ["Daft Punk", "Pharrell Williams"],
        )
        self.assertEqual(result, "Daft Punk - Pharrell Williams - Random Access Memories")

    def test_format_album_display_name_avoids_duplicate_prefix(self):
        result = _format_album_display_name(
            "Daft Punk - Random Access Memories",
            ["Daft Punk"],
        )
        self.assertEqual(result, "Daft Punk - Random Access Memories")


class TrackNamingTests(unittest.TestCase):
    def test_formatted_item_name_dedupes_artist_prefix_for_track(self):
        result = _formatted_item_name(
            "track",
            {
                "name": "Andreas Gidlund - Everytime We Say Hello",
                "artist_names": ["Andreas Gidlund"],
            },
        )
        self.assertEqual(result, "Andreas Gidlund - Everytime We Say Hello")

    def test_parse_track_title_removes_song_and_lyrics_suffix(self):
        title = (
            "Andreas Gidlund - Everytime We Say Hello - song and lyrics by Andreas Gidlund | Spotify"
        )
        self.assertEqual(_parse_track_title(title), "Everytime We Say Hello")


class CrawlDedupeTests(unittest.IsolatedAsyncioTestCase):
    async def test_resolve_or_create_item_reuses_existing_and_deletes_duplicates(self):
        target_user_id = uuid.uuid4()
        primary = Item(
            id=uuid.uuid4(),
            spotify_id="abc123",
            item_type="track",
            user_id=target_user_id,
            group="group-a",
        )
        duplicate = Item(
            id=uuid.uuid4(),
            spotify_id="abc123",
            item_type="track",
            user_id=target_user_id,
            group="group-a",
        )
        db = _FakeAsyncDb([primary, duplicate])

        with patch("app.api.crawl._delete_duplicate_rows", new=AsyncMock()) as delete_mock:
            result = await crawl_api._resolve_or_create_item(
                db,
                spotify_id="abc123",
                item_type="track",
                target_user_id=target_user_id,
                requested_group="group-a",
                remove_duplicates=True,
            )

        self.assertIs(result, primary)
        delete_mock.assert_awaited_once_with(db, [duplicate])
        self.assertEqual(db.add_calls, [])
        db.flush.assert_not_awaited()

    async def test_resolve_or_create_item_creates_new_item_when_no_duplicate(self):
        target_user_id = uuid.uuid4()
        db = _FakeAsyncDb([])

        result = await crawl_api._resolve_or_create_item(
            db,
            spotify_id="new123",
            item_type="album",
            target_user_id=target_user_id,
            requested_group="group-b",
            remove_duplicates=True,
        )

        self.assertIsInstance(result, Item)
        self.assertEqual(result.spotify_id, "new123")
        self.assertEqual(result.item_type, "album")
        self.assertEqual(result.group, "group-b")
        self.assertEqual(result.user_id, target_user_id)
        self.assertEqual(result.status, "crawling")
        self.assertEqual(len(db.add_calls), 1)
        self.assertIs(db.add_calls[0], result)
        db.flush.assert_awaited_once()
