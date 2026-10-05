"""Item model — stores normalized Spotify entity data."""

import uuid
from datetime import datetime

from sqlalchemy import (
    String,
    Integer,
    BigInteger,
    DateTime,
    Text,
    Index,
    ForeignKey,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Item(Base):
    """A Spotify entity: artist, track, album, or playlist."""

    __tablename__ = "items"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    spotify_id: Mapped[str] = mapped_column(
        String(64), nullable=False, index=True
    )
    item_type: Mapped[str] = mapped_column(
        String(16), nullable=False
    )  # artist|track|album|playlist
    name: Mapped[str] = mapped_column(String(512), nullable=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Owner / Artist ──
    owner_name: Mapped[str | None] = mapped_column(String(256), nullable=True)
    owner_image: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Metrics (latest snapshot) ──
    followers: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    monthly_listeners: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    playcount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    track_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    album_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    release_date: Mapped[str | None] = mapped_column(String(32), nullable=True)

    # ── Status ──
    status: Mapped[str] = mapped_column(
        String(16), default="pending"
    )  # active|error|pending|crawling
    error_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Grouping ──
    group: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    workspace: Mapped[str] = mapped_column(String(32), nullable=False, default="spotify", server_default="spotify", index=True)

    # ── User ownership ──
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True
    )

    # ── Timestamps ──
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )
    last_checked: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_items_type_status", "item_type", "status"),
        Index("ix_items_user_type_spotify", "user_id", "item_type", "spotify_id"),
    )
