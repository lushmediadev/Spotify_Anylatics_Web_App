"""Item model - stores tracked YouTube channels."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.ytm.database import Base


class Item(Base):
    """A tracked YouTube channel."""

    __tablename__ = "ytm_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    youtube_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    query: Mapped[str] = mapped_column(String(512), nullable=False, index=True)
    query_type: Mapped[str] = mapped_column(String(24), nullable=False, default="url")
    item_type: Mapped[str] = mapped_column(String(16), nullable=False, default="channel")
    name: Mapped[str | None] = mapped_column(String(512), nullable=True)
    image: Mapped[str | None] = mapped_column(Text, nullable=True)
    banner_image: Mapped[str | None] = mapped_column(Text, nullable=True)

    video_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    subscriber_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    view_count_delta: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    delta_days: Mapped[int | None] = mapped_column(Integer, nullable=True)

    status: Mapped[str] = mapped_column(String(16), default="pending")
    error_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    group: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("ytm_users.id", ondelete="CASCADE"), nullable=False, index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_checked: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    __table_args__ = (
        Index("ytm_ix_items_user_status", "user_id", "status"),
        Index("ytm_ix_items_user_query", "user_id", "query_type", "query"),
        Index("ytm_ix_items_user_youtube", "user_id", "youtube_id"),
    )
