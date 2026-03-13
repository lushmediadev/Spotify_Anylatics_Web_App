from app.api import items as items_api
from app.models.item import Item


def _playlist_item(spotify_id: str, name: str) -> Item:
    return Item(
        spotify_id=spotify_id,
        item_type="playlist",
        name=name,
    )


def _album_item(spotify_id: str, name: str) -> Item:
    return Item(
        spotify_id=spotify_id,
        item_type="album",
        name=name,
    )


def test_format_export_metric_plain_digits():
    assert items_api._format_export_metric(1234567) == "1234567"
    assert items_api._format_export_metric(1234567.0) == "1234567"
    assert items_api._format_export_metric(1234.5) == "1234.5"


def test_build_playlist_type3_rows_side_by_side():
    playlists = [
        _playlist_item("p1", "Playlist A"),
        _playlist_item("p2", "Playlist B"),
    ]
    raw_map = {
        "p1": {
            "tracks": [
                {
                    "name": "Track A1",
                    "artist_names": ["Artist A"],
                    "spotify_url": "https://open.spotify.com/track/a1",
                    "playcount_estimate": 1000,
                },
                {
                    "name": "Track A2",
                    "artist_names": ["Artist A"],
                    "spotify_url": "https://open.spotify.com/track/a2",
                    "playcount_estimate": 2000,
                },
            ]
        },
        "p2": {
            "tracks": [
                {
                    "name": "Track B1",
                    "artist_names": ["Artist B"],
                    "spotify_url": "https://open.spotify.com/track/b1",
                    "playcount_estimate": 3000,
                },
            ]
        },
    }

    headers, rows, _ = items_api._build_playlist_type3_rows(playlists, raw_map)

    assert len(headers) == 6
    assert headers[0].startswith("Playlist A | Artist - Track")
    assert headers[3].startswith("Playlist B | Artist - Track")
    assert len(rows) == 2
    assert rows[0] == [
        "Artist A - Track A1",
        "https://open.spotify.com/track/a1",
        "1000",
        "Artist B - Track B1",
        "https://open.spotify.com/track/b1",
        "3000",
    ]
    assert rows[1] == [
        "Artist A - Track A2",
        "https://open.spotify.com/track/a2",
        "2000",
        "",
        "",
        "",
    ]


def test_build_album_type0_rows_side_by_side():
    albums = [
        _album_item("a1", "Artist X - Album X"),
        _album_item("a2", "Artist Y - Artist Z - Album Y"),
    ]
    raw_map = {
        "a1": {
            "tracks": [
                {
                    "name": "Song X1",
                    "spotify_url": "https://open.spotify.com/track/x1",
                    "playcount_estimate": 11,
                }
            ]
        },
        "a2": {
            "tracks": [
                {
                    "name": "Song Y1",
                    "spotify_url": "https://open.spotify.com/track/y1",
                    "playcount_estimate": 22,
                },
                {
                    "name": "Song Y2",
                    "spotify_url": "https://open.spotify.com/track/y2",
                    "playcount_estimate": 33,
                },
            ]
        },
    }

    headers, rows, _ = items_api._build_album_type0_rows(albums, raw_map)

    assert len(headers) == 10
    assert headers[0].startswith("Artist X - Album X | Album")
    assert headers[5].startswith("Artist Y - Artist Z - Album Y | Album")
    assert len(rows) == 2
    assert rows[0] == [
        "Artist X - Album X",
        "1",
        "Song X1",
        "https://open.spotify.com/track/x1",
        "11",
        "Artist Y - Artist Z - Album Y",
        "1",
        "Song Y1",
        "https://open.spotify.com/track/y1",
        "22",
    ]
    assert rows[1] == [
        "",
        "",
        "",
        "",
        "",
        "Artist Y - Artist Z - Album Y",
        "2",
        "Song Y2",
        "https://open.spotify.com/track/y2",
        "33",
    ]

