from fastapi.testclient import TestClient

from app.main import app


def test_every_response_carries_noindex_header():
    client = TestClient(app)
    for path in ("/api/health", "/api/auth/me", "/", "/login.html", "/missing-page"):
        response = client.get(path)
        assert response.headers.get("x-robots-tag") == "noindex, nofollow", path
