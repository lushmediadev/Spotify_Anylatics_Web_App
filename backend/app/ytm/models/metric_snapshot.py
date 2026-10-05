"""Metric snapshots used to calculate channel deltas."""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.ytm.database import Base


class MetricSnapshot(Base):
    """Stored public metric point for a tracked channel."""

    __tablename__ = "ytm_metric_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("ytm_items.id", ondelete="CASCADE"), nullable=False, index=True)
    view_count: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    checked_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        Index("ytm_ix_metric_snapshots_item_checked", "item_id", "checked_at"),
    )
