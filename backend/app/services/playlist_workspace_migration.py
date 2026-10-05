"""Copy legacy associations and snapshots without changing checker records."""
import uuid
from sqlalchemy import select, update
from app.models.item import Item
from app.models.metrics_snapshot import MetricsSnapshot
from app.models.youtube import ChannelPlaylist, YouTubeWorkspacePreference


async def migrate_playlist_workspace(db):
    links = list((await db.execute(select(ChannelPlaylist, Item).join(Item, Item.id == ChannelPlaylist.item_id)
        .where(Item.workspace == "spotify").order_by(Item.id).with_for_update())).all())
    replacements = {}
    for association, source in links:
        if source.id not in replacements:
            fields = {column.name: getattr(source, column.name) for column in Item.__table__.columns if column.name not in {"id", "workspace"}}
            if fields["status"] == "crawling":
                fields["status"] = "active" if fields["last_checked"] else "pending"
            clone = Item(id=uuid.uuid4(), workspace="channel-playlists", **fields)
            db.add(clone)
            await db.flush()
            replacements[source.id] = clone.id
            snapshots = list((await db.execute(select(MetricsSnapshot).where(MetricsSnapshot.item_id == source.id))).scalars())
            for snapshot in snapshots:
                values = {column.name: getattr(snapshot, column.name) for column in MetricsSnapshot.__table__.columns if column.name not in {"id", "item_id"}}
                db.add(MetricsSnapshot(id=uuid.uuid4(), item_id=clone.id, **values))
        await db.execute(update(ChannelPlaylist).where(ChannelPlaylist.channel_id == association.channel_id,
            ChannelPlaylist.item_id == source.id).values(item_id=replacements[source.id]))
    if replacements:
        mapping = {str(old): str(new) for old, new in replacements.items()}
        preferences = list((await db.execute(select(YouTubeWorkspacePreference).with_for_update())).scalars())
        for preference in preferences:
            preference.playlist_orders = {channel: [mapping.get(value, value) for value in order]
                for channel, order in (preference.playlist_orders or {}).items()}
    await db.flush()
    return len(replacements)
