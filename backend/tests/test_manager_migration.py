import asyncio

from sqlalchemy.dialects import postgresql
from sqlalchemy.schema import CreateTable

from app import database
from app.models.user import User


def test_manager_model_has_nullable_uuid_fk_and_index():
    column = User.__table__.c.manager_id
    assert column.nullable
    assert column.index
    foreign_key = next(iter(column.foreign_keys))
    assert foreign_key.target_fullname == "users.id"
    assert foreign_key.ondelete == "SET NULL"
    ddl = str(CreateTable(User.__table__).compile(dialect=postgresql.dialect()))
    assert "manager_id UUID" in ddl
    assert "FOREIGN KEY(manager_id) REFERENCES users (id) ON DELETE SET NULL" in ddl


def test_startup_repeats_additive_manager_migration(monkeypatch):
    statements = []

    class Connection:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def run_sync(self, callback):
            assert callback == database.Base.metadata.create_all

        async def execute(self, statement):
            statements.append(str(statement))

    class Engine:
        def begin(self):
            return Connection()

    monkeypatch.setattr(database, "engine", Engine())
    asyncio.run(database.init_db())
    asyncio.run(database.init_db())
    manager_statements = [sql for sql in statements if "manager_id" in sql]
    assert manager_statements == [
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS manager_id UUID REFERENCES users(id) ON DELETE SET NULL",
        "CREATE INDEX IF NOT EXISTS ix_users_manager_id ON users(manager_id)",
    ] * 2
