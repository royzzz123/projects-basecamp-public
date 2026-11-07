"""Session persistence using the SEBI-project MongoDB."""
import uuid
from datetime import datetime, timezone

from motor.motor_asyncio import AsyncIOMotorDatabase


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def ensure_indexes(db: AsyncIOMotorDatabase) -> None:
    col = db["chat_sessions"]
    await col.create_index("session_id", unique=True)
    await col.create_index("updated_at")


async def load_session(db: AsyncIOMotorDatabase, session_id: str) -> list[dict]:
    """Return the messages list for a session, or [] if not found."""
    doc = await db["chat_sessions"].find_one(
        {"session_id": session_id}, {"_id": 0, "messages": 1}
    )
    return doc["messages"] if doc else []


async def save_turn(
    db: AsyncIOMotorDatabase,
    session_id: str,
    user_message: str,
    assistant_message: str,
) -> None:
    """Append a user+assistant turn to the session, creating it if needed."""
    now = _now()
    new_msgs = [
        {"role": "user", "content": user_message, "timestamp": now},
        {"role": "assistant", "content": assistant_message, "timestamp": now},
    ]
    await db["chat_sessions"].update_one(
        {"session_id": session_id},
        {
            "$push": {"messages": {"$each": new_msgs}},
            "$set": {"updated_at": now},
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )


async def list_sessions(db: AsyncIOMotorDatabase, limit: int = 20) -> list[dict]:
    """Return recent sessions sorted by last activity, with a preview of the first message."""
    pipeline = [
        {"$sort": {"updated_at": -1}},
        {"$limit": limit},
        {"$project": {
            "_id": 0,
            "session_id": 1,
            "updated_at": 1,
            "first_msg": {"$arrayElemAt": ["$messages", 0]},
        }},
    ]
    docs = await db["chat_sessions"].aggregate(pipeline).to_list(length=limit)
    result = []
    for d in docs:
        first_msg = d.get("first_msg") or {}
        content = first_msg.get("content", "")
        result.append({
            "session_id": d["session_id"],
            "updated_at": d["updated_at"].isoformat() if d.get("updated_at") else "",
            "preview": content[:60] + ("…" if len(content) > 60 else ""),
        })
    return result


def new_session_id() -> str:
    return str(uuid.uuid4())
