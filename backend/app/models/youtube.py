"""Owner-scoped YouTube channels and Spotify playlist links."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class YouTubeApiKey(Base):
    __tablename__ = "youtube_api_keys"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    key: Mapped[str] = mapped_column(Text)
    position: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (UniqueConstraint("user_id", "key"),)


class Channel(Base):
    __tablename__ = "youtube_channels"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    query_type: Mapped[str] = mapped_column(String(16))
    query: Mapped[str] = mapped_column(String(256))
    youtube_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)
    banner: Mapped[str | None] = mapped_column(Text, nullable=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    view_count_delta: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    delta_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    group: Mapped[str] = mapped_column(String(128), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_checked: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    refresh_started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("user_id", "query_type", "query"),
        UniqueConstraint("user_id", "youtube_id"),
    )


class YouTubeChannelGroup(Base):
    __tablename__ = "youtube_channel_groups"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128))
    __table_args__ = (UniqueConstraint("user_id", "name"),)


class ChannelSnapshot(Base):
    __tablename__ = "youtube_channel_snapshots"
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("youtube_channels.id", ondelete="CASCADE"), index=True)
    view_count: Mapped[int] = mapped_column(BigInteger)
    captured_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ChannelPlaylist(Base):
    __tablename__ = "youtube_channel_playlists"
    channel_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("youtube_channels.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), primary_key=True)
