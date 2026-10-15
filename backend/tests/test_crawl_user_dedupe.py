import asyncio
from types import SimpleNamespace
import uuid

from app.api import crawl as crawl_api
from app.schemas.crawl import CrawlBatchRequest, CrawlRequest


class FakeDB:
    def __init__(self):
        self.added = []
        self.flush_calls = 0
        self.commit_calls = 0

    def add(self, obj):
        self.added.append(obj)

    async def flush(self):
        self.flush_calls += 1
        for obj in self.added:
            if getattr(obj, "id", None) is None:
                obj.id = uuid.uuid4()

    async def commit(self):
        self.commit_calls += 1


def test_crawl_skips_duplicate_for_same_user(monkeypatch):
    async def run():
        current_user = SimpleNamespace(id=uuid.uuid4(), role="user")
        existing_item = SimpleNamespace(id=uuid.uuid4())
        db = FakeDB()

        async def fake_resolve_target_user_id(db, current_user, requested_user_id):
            return current_user.id

        async def fake_find_existing_owned_item(db, current_user, target_user_id, item_type, spotify_id):
            assert target_user_id == current_user.id
            assert item_type == "track"
            assert spotify_id == "abc123"
            return existing_item

        monkeypatch.setattr(crawl_api, "_resolve_target_user_id", fake_resolve_target_user_id)
        monkeypatch.setattr(crawl_api, "_find_existing_owned_item", fake_find_existing_owned_item)

        response = await crawl_api.crawl(
            CrawlRequest(url="https://open.spotify.com/track/abc123", group="Test"),
            db=db,
            current_user=current_user,
        )

        assert response.skipped_duplicate is True
        assert response.status == "duplicate"
        assert response.job_id is None
        assert response.item_id == str(existing_item.id)
        assert db.added == []
        assert db.commit_calls == 0

    asyncio.run(run())


def test_crawl_batch_skips_duplicates_and_preserves_created_job_mapping(monkeypatch):
    async def run():
        current_user = SimpleNamespace(id=uuid.uuid4(), role="user")
        db = FakeDB()

        async def fake_resolve_target_user_id(db, current_user, requested_user_id):
            return current_user.id

        async def fake_find_existing_owned_item(db, current_user, target_user_id, item_type, spotify_id):
            if spotify_id == "dup001":
                return SimpleNamespace(id=uuid.uuid4())
            return None

        scheduled = []

        def fake_create_task(coro):
            scheduled.append(coro)
            coro.close()
            return SimpleNamespace()

        monkeypatch.setattr(crawl_api, "_resolve_target_user_id", fake_resolve_target_user_id)
        monkeypatch.setattr(crawl_api, "_find_existing_owned_item", fake_find_existing_owned_item)
        monkeypatch.setattr(crawl_api.asyncio, "create_task", fake_create_task)

        response = await crawl_api.crawl_batch(
            CrawlBatchRequest(
                urls=[
                    "https://open.spotify.com/track/dup001",
                    "https://open.spotify.com/track/new002",
                ],
                group="Test",
            ),
            db=db,
            current_user=current_user,
        )

        assert response.count == 1
        assert len(response.job_ids) == 1
        assert response.accepted_indices == [1]
        assert response.skipped_duplicates == 1
        assert db.commit_calls == 1
        assert len(scheduled) == 1

    asyncio.run(run())


def test_crawl_rejects_new_link_without_group():
    async def run():
        current_user = SimpleNamespace(id=uuid.uuid4(), role="user")
        db = FakeDB()

        try:
            await crawl_api.crawl(
                CrawlRequest(url="https://open.spotify.com/track/new003"),
                db=db,
                current_user=current_user,
            )
        except Exception as exc:
            assert isinstance(exc, crawl_api.HTTPException)
            assert exc.status_code == 400
            assert exc.detail == "Select a group before adding a new link"
        else:
            raise AssertionError("Expected group selection to be required")

    asyncio.run(run())


def test_admin_can_add_same_link_for_different_target_users():
    async def run():
        admin_user = SimpleNamespace(id=uuid.uuid4(), role="admin")
        user_one_id = uuid.uuid4()
        user_two_id = uuid.uuid4()

        class CaptureDB:
            def __init__(self):
                self.queries = []

            async def execute(self, query):
                self.queries.append(str(query))

                class _ScalarResult:
                    def first(self_nonlocal):
                        return None

                class _Result:
                    def scalars(self_nonlocal):
                        return _ScalarResult()

                return _Result()

        db = CaptureDB()

        await crawl_api._find_existing_owned_item(
            db=db,
            current_user=admin_user,
            target_user_id=user_one_id,
            item_type="track",
            spotify_id="same123",
        )
        await crawl_api._find_existing_owned_item(
            db=db,
            current_user=admin_user,
            target_user_id=user_two_id,
            item_type="track",
            spotify_id="same123",
        )

        assert len(db.queries) == 2
        assert "items.user_id = :user_id_1" in db.queries[0]
        assert "items.user_id IS NULL" not in db.queries[0]
        assert "items.user_id = :user_id_1" in db.queries[1]
        assert "items.user_id IS NULL" not in db.queries[1]

    asyncio.run(run())
