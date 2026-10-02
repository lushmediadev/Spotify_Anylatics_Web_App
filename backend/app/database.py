"""SQLAlchemy async engine & session factory."""

import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

def _normalize_database_url(raw_url: str) -> str:
    """
    Ensure SQLAlchemy async engine uses asyncpg driver.

    Railway/Postgres plugins often expose `postgresql://...` (or `postgres://...`).
    This backend uses SQLAlchemy async engine, so it must be:
    `postgresql+asyncpg://...`
    """
    url = (raw_url or "").strip()
    if not url:
        return url
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql://", 1)
    if url.startswith("postgresql+asyncpg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


DATABASE_URL = _normalize_database_url(settings.DATABASE_URL)
logger = logging.getLogger(__name__)

engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Declarative base for all ORM models."""

    pass


async def get_db() -> AsyncSession:
    """FastAPI dependency — yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db():
    """Create all tables and add missing columns for migrations."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    # Add columns that may be missing from older deployments.
    # Each migration runs in its own transaction because PostgreSQL
    # aborts the entire transaction when any statement fails.
    migrations = [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_users_manager_id ON users(manager_id)",
        "ALTER TABLE items ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)",
        "CREATE INDEX IF NOT EXISTS ix_items_user_id ON items(user_id)",
        """
        DO $$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN
                SELECT c.conname AS constraint_name
                FROM pg_constraint c
                JOIN pg_class t ON t.oid = c.conrelid
                JOIN pg_namespace n ON n.oid = t.relnamespace
                WHERE t.relname = 'items'
                  AND n.nspname = current_schema()
                  AND c.contype = 'u'
                  AND array_length(c.conkey, 1) = 1
                  AND (
                        SELECT a.attname
                        FROM pg_attribute a
                        WHERE a.attrelid = t.oid
                          AND a.attnum = c.conkey[1]
                  ) = 'spotify_id'
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                    current_schema(),
                    'items',
                    rec.constraint_name
                );
            END LOOP;
        END $$;
        """,
        """
        DO $$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                    AND tc.table_name = kcu.table_name
                WHERE tc.table_schema = current_schema()
                  AND tc.table_name = 'items'
                  AND tc.constraint_type = 'UNIQUE'
                GROUP BY tc.constraint_name
                HAVING bool_or(kcu.column_name = 'spotify_id')
                   AND NOT bool_or(kcu.column_name = 'user_id')
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                    current_schema(),
                    'items',
                    rec.constraint_name
                );
            END LOOP;
        END $$;
        """,
        "DROP INDEX IF EXISTS items_spotify_id_key",
        "DROP INDEX IF EXISTS uq_items_spotify_id",
        """
        DO $$
        DECLARE rec RECORD;
        BEGIN
            FOR rec IN
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                    ON tc.constraint_name = kcu.constraint_name
                    AND tc.table_schema = kcu.table_schema
                    AND tc.table_name = kcu.table_name
                WHERE tc.table_schema = current_schema()
                  AND tc.table_name = 'items'
                  AND tc.constraint_type = 'UNIQUE'
                GROUP BY tc.constraint_name
                HAVING COUNT(*) = 3
                   AND bool_and(kcu.column_name IN ('user_id', 'item_type', 'spotify_id'))
            LOOP
                EXECUTE format(
                    'ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I',
                    current_schema(),
                    'items',
                    rec.constraint_name
                );
            END LOOP;
        END $$;
        """,
        "DROP INDEX IF EXISTS uq_items_user_type_spotify",
        "DROP INDEX IF EXISTS items_user_id_item_type_spotify_id_key",
        "CREATE INDEX IF NOT EXISTS ix_items_spotify_id ON items(spotify_id)",
        "CREATE INDEX IF NOT EXISTS ix_items_user_type_spotify ON items(user_id, item_type, spotify_id)",
        "CREATE INDEX IF NOT EXISTS ix_raw_responses_spotify_captured ON raw_responses(spotify_id, captured_at DESC)",
        "CREATE INDEX IF NOT EXISTS ix_metrics_snapshots_item_captured ON metrics_snapshots(item_id, captured_at DESC)",
        "ALTER TABLE crawl_jobs ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id)",
        "CREATE INDEX IF NOT EXISTS ix_crawl_jobs_user_id ON crawl_jobs(user_id)",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_groups TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS ui_preferences TEXT",
        "ALTER TABLE metrics_snapshots ADD COLUMN IF NOT EXISTS track_count INTEGER",
    ]
    for sql in migrations:
        try:
            async with engine.begin() as conn:
                await conn.execute(text(sql))
        except Exception as ex:
            logger.warning("DB migration step failed: %s | sql=%s", ex, sql.strip().splitlines()[0])
