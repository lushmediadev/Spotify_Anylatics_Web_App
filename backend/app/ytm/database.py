from app.database import Base, engine, async_session, get_db  # noqa: F401

# YTM routes deliberately reuse the shared ``app.database.get_db`` dependency
# object: both drew from the same ``async_session`` factory/engine with identical
# commit/rollback handling, and sharing the callable lets FastAPI's per-request
# dependency cache hand the shared auth dependency and YTM routes ONE session
# (one pooled connection) instead of two.


async def init_db():
    from app.ytm import models  # noqa: F401
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
