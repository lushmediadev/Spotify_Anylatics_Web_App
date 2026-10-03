"""Loopback-only UI fixture. No production credentials or external API writes."""
import json
import argparse
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

ROOT = Path(__file__).resolve().parents[1]
USER = {"id": "11111111-1111-4111-8111-111111111111", "username": "preview", "display_name": "Preview Admin", "role": "admin", "is_active": True}
NOW = datetime.now(timezone.utc).isoformat()
ITEMS = [{"id": f"22222222-2222-4222-8222-{i:012d}", "spotify_id": "37i9dQZF1DWV7EzJMK2FUI", "type": "playlist", "name": name, "image": None, "owner_name": "Spotify", "followers": 2328473+i, "followers_delta": 9960, "track_count": 210, "track_count_delta": 0, "delta_days": 21, "status": "active", "group": "Jazz", "user_id": USER["id"], "user_name": "Preview Admin", "last_checked": NOW, "created_at": NOW} for i, name in enumerate(["Jazz in the Background", "Coffee Table Jazz", "Jazz for Study"])]
CHANNELS = [{"id": f"33333333-3333-4333-8333-{i:012d}", "user_id": USER["id"], "query_type": "channel", "query": "UC_x5XG1OV2P6uZZ5FSM9Ttw", "youtube_id": "UC_x5XG1OV2P6uZZ5FSM9Ttw", "name": name, "image": None, "banner": None, "youtube_url": "https://www.youtube.com/channel/UC_x5XG1OV2P6uZZ5FSM9Ttw", "view_count": 21293069+i, "view_count_delta": 1129620, "delta_days": 50, "status": "active", "error_message": None, "group": "Jazz Channels", "created_at": NOW, "last_checked": NOW, "playlists": ITEMS[:2] if i == 0 else []} for i, name in enumerate(["Jazz Radio Channel", "Cozy Jazz Vibes"])]
KEYS = ""
GROUPS = {"Jazz Channels"}
PREFERENCES = {"group_order": [], "channel_orders": {}, "playlist_orders": {}}
CHANNELS[0].update({
    "image": "https://yt3.ggpht.com/vgjeI6bGloHkTjzYvvYFiJsymYX6X2IA6LlP_dVFL7Fa4kocWrgHvLxXmX5M2gwzcQeMBT2z=s800-c-k-c0x00ffffff-no-rj",
    "banner": "https://yt3.googleusercontent.com/trO9SyI6tvFVEVOeZ2ISUtETSwro_2emwuvF0D-HCFMcPMUH0ZGxBHFz1zeL_Wi-sA9X2mGt3g=w1707-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj",
})
for item in ITEMS:
    item["image"] = "https://image-cdn-ak.spotifycdn.com/image/ab67706c0000da841b8aa5219683fc248f7cbe49"
CHANNEL_TEMPLATE = dict(CHANNELS[0])

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def send_json(self, data, status=200):
        raw = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        route = urlsplit(self.path).path
        if not route.startswith("/api/"):
            return super().do_GET()
        if route == "/api/auth/me": return self.send_json(USER)
        if route == "/api/auth/users": return self.send_json([USER])
        if route == "/api/auth/me/preferences": return self.send_json({"preferences": {}, "global_preferences": {"playlist_clipboard_line_limit": 200}})
        if route == "/api/health": return self.send_json({"status": "ok"})
        if route == "/api/items/summary": return self.send_json({"total": 3, "all_total": 3, "active": 3, "errors": 0, "crawling": 0, "groups": [{"name": "Jazz", "count": 3}]})
        if route == "/api/items": return self.send_json({"items": ITEMS, "total": len(ITEMS)})
        if route == "/api/youtube/keys": return self.send_json({"api_keys": KEYS})
        if route == "/api/youtube/preferences": return self.send_json(PREFERENCES)
        if route == "/api/youtube/channels":
            query = parse_qs(urlsplit(self.path).query)
            rows = [r for r in CHANNELS if not query.get("search") or query["search"][0].lower() in r["name"].lower()]
            if query.get("group"):
                rows = [r for r in rows if r["group"] == query["group"][0]]
            names = sorted(GROUPS, key=lambda name: (PREFERENCES["group_order"].index(name) if name in PREFERENCES["group_order"] else len(GROUPS), name))
            groups = [{"name": name, "count": sum(r["group"] == name for r in CHANNELS)} for name in names]
            order = PREFERENCES["channel_orders"].get(query.get("group", [""])[0], [])
            rows.sort(key=lambda row: order.index(row["id"]) if row["id"] in order else len(order))
            rows = [dict(row, playlists=sorted(row["playlists"], key=lambda item: PREFERENCES["playlist_orders"].get(row["id"], []).index(item["id"]) if item["id"] in PREFERENCES["playlist_orders"].get(row["id"], []) else 5000)) for row in rows]
            offset = max(0, int(query.get("offset", [0])[0]))
            limit = min(500, max(1, int(query.get("limit", [50])[0])))
            return self.send_json({"items": rows[offset:offset+limit], "total": len(rows), "groups": groups, "key_count": int(bool(KEYS)), "has_keys": bool(KEYS)})
        self.send_json({})

    def do_POST(self):
        route = urlsplit(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if route == "/api/auth/login": return self.send_json({"access_token": "loopback-preview-only", "user": USER})
        if route == "/api/youtube/keys/check": return self.send_json({"results": [{"position": 1, "valid": True, "status": "ok"}]})
        if route == "/api/youtube/groups":
            GROUPS.add(body["name"])
            return self.send_json({"name": body["name"], "count": 0})
        if route == "/api/youtube/groups/delete":
            names = set(body["names"])
            for row in CHANNELS:
                if row["group"] in names:
                    row["group"] = "Ungrouped"
                    GROUPS.add("Ungrouped")
            GROUPS.difference_update(names)
            return self.send_json({"deleted": len(names)})
        if route == "/api/youtube/channels/move":
            for row in CHANNELS:
                if row["id"] in body["channel_ids"]: row["group"] = body["group"]
            return self.send_json({"moved": len(body["channel_ids"])})
        if route == "/api/youtube/channels/delete":
            CHANNELS[:] = [row for row in CHANNELS if row["id"] not in body["channel_ids"]]
            return self.send_json({"deleted": len(body["channel_ids"])})
        if route == "/api/youtube/groups/clear":
            total = sum(row["group"] == body["name"] for row in CHANNELS)
            CHANNELS[:] = [row for row in CHANNELS if row["group"] != body["name"]]
            return self.send_json({"deleted": total})
        if route == "/api/youtube/channels":
            row = {**CHANNEL_TEMPLATE, "id": f"preview-{len(CHANNELS)}", "name": body["urls"][0], "group": body["group"], "playlists": []}
            CHANNELS.append(row)
            GROUPS.add(body["group"])
            return self.send_json({"accepted": 1, "skipped": 0, "items": [row]})
        self.send_json({"accepted": 1, "skipped": 0})

    def do_PUT(self):
        global KEYS
        route = urlsplit(self.path).path
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if route == "/api/youtube/keys":
            KEYS = body.get("api_keys", "")
            return self.send_json({"api_keys": KEYS})
        if route == "/api/youtube/preferences":
            for key, value in body.items():
                if key == "group_order": PREFERENCES[key] = value
                elif key in PREFERENCES: PREFERENCES[key].update(value)
            return self.send_json(PREFERENCES)
        if route.endswith("/playlists"):
            row = next(r for r in CHANNELS if r["id"] == route.split("/")[-2])
            row["playlists"] = [item for item in ITEMS if item["id"] in body.get("item_ids", [])]
            return self.send_json(row)
        self.send_json({})

    def do_PATCH(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if urlsplit(self.path).path == "/api/youtube/groups":
            GROUPS.discard(body["old_name"])
            GROUPS.add(body["new_name"])
            for row in CHANNELS:
                if row["group"] == body["old_name"]: row["group"] = body["new_name"]
            return self.send_json({"name": body["new_name"]})
        self.send_json({})

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8010)
    parser.add_argument("--empty", action="store_true")
    args = parser.parse_args()
    if args.empty:
        CHANNELS.clear()
        GROUPS.clear()
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
