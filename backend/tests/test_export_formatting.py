from types import SimpleNamespace

from app.api import items as items_api


def _playlist_item(spotify_id: str, name: str, owner_name: str = "", playcount: int | None = None):
    return SimpleNamespace(
        item_type="playlist",
        spotify_id=spotify_id,
        name=name,
        owner_name=owner_name,
        playcount=playcount,
    )


def _album_item(spotify_id: str, name: str, playcount: int | None = None):
    return SimpleNamespace(
        item_type="album",
        spotify_id=spotify_id,
        name=name,
        playcount=playcount,
    )


def test_format_export_metric_uses_plain_digits():
    assert items_api._format_export_metric(1234567) == "1234567"
    assert items_api._format_export_metric(9000.0) == "9000"
    assert items_api._format_export_metric(12.5) == "12.5"


def test_build_artist_track_title_removes_repeated_prefix():
    result = items_api._build_artist_track_title(
        "Andreas Gidlund",
        "Andreas Gidlund - Andreas Gidlund - Everytime We Say Hello",
    )
    assert result == "Andreas Gidlund - Everytime We Say Hello"


def test_playlist_type3_export_is_side_by_side_by_playlist():
    items = [
        _playlist_item("playlist-1", "Playlist One"),
        _playlist_item("playlist-2", "Playlist Two"),
    ]
    raw_map = {
        "playlist-1": {
            "tracks": [
                {"name": "Track 1A", "artist_names": ["Artist A"], "spotify_id": "track-1a", "playcount_estimate": 111},
                {"name": "Track 1B", "artist_names": ["Artist B"], "spotify_id": "track-1b", "playcount_estimate": 112},
            ]
        },
        "playlist-2": {
            "tracks": [
                {"name": "Track 2A", "artist_names": ["Artist C"], "spotify_id": "track-2a", "playcount_estimate": 221},
            ]
        },
    }

    headers, rows, _ = items_api._build_playlist_type3_rows(items, raw_map)

    assert len(headers) == 6
    assert headers[0].startswith("Playlist One |")
    assert headers[3].startswith("Playlist Two |")
    assert len(rows) == 2
    assert rows[0][0] == "Artist A - Track 1A"
    assert rows[0][3] == "Artist C - Track 2A"
    assert rows[1][0] == "Artist B - Track 1B"
    assert rows[1][3:6] == ["", "", ""]


def test_album_type0_export_keeps_full_album_title_and_side_by_side_columns():
    album_1_name = "Artist A - Artist B - Album One"
    album_2_name = "Artist C - Album Two"
    items = [
        _album_item("album-1", album_1_name),
        _album_item("album-2", album_2_name),
    ]
    raw_map = {
        "album-1": {
            "tracks": [
                {"name": "Song 1", "spotify_id": "song-1", "playcount_estimate": 500},
            ]
        },
        "album-2": {
            "tracks": [
                {"name": "Song 2", "spotify_id": "song-2", "playcount_estimate": 700},
            ]
        },
    }

    headers, rows, _ = items_api._build_album_type0_rows(items, raw_map)

    assert len(headers) == 10
    assert headers[0] == f"{album_1_name} | Album"
    assert headers[5] == f"{album_2_name} | Album"
    assert len(rows) == 1
    assert rows[0][0] == album_1_name
    assert rows[0][5] == album_2_name
