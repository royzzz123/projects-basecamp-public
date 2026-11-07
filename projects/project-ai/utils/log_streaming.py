"""Per-request log capture + NDJSON streaming helper.

Lets an HTTP handler stream its own log records back to the caller as the work
happens. A `contextvars` scoped queue keeps each request's logs separate, so
concurrent requests don't see each other's lines.

Wire-up:
    install_streaming_handler()   # attach once at import / startup
    return StreamingResponse(stream_with_logs(my_coro()), media_type="application/x-ndjson")

Each yielded line is one JSON object terminated by '\\n':
    {"type": "log",    "level": "INFO", "msg": "..."}
    {"type": "result", "data": {...}}
    {"type": "error",  "msg": "..."}
"""

from __future__ import annotations

import asyncio
import contextvars
import json
import logging
from typing import Any, AsyncIterator, Awaitable

from pydantic import BaseModel

_request_log_queue: contextvars.ContextVar[asyncio.Queue | None] = contextvars.ContextVar(
    "request_log_queue", default=None
)


class _RequestQueueHandler(logging.Handler):
    """Routes log records into the current request's queue, if one is set."""

    def emit(self, record: logging.LogRecord) -> None:
        q = _request_log_queue.get()
        if q is None:
            return
        try:
            msg = self.format(record)
        except Exception:
            return
        try:
            q.put_nowait({"type": "log", "level": record.levelname, "msg": msg})
        except asyncio.QueueFull:
            pass


_installed = False


def install_streaming_handler() -> None:
    """Attach the queue handler to the root logger exactly once. Idempotent."""
    global _installed
    if _installed:
        return
    handler = _RequestQueueHandler()
    handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))
    handler.setLevel(logging.INFO)
    logging.getLogger().addHandler(handler)
    _installed = True


async def stream_with_logs(coro: Awaitable[Any]) -> AsyncIterator[bytes]:
    """Run `coro` and yield NDJSON: log events as they happen, then result or error."""
    install_streaming_handler()
    q: asyncio.Queue = asyncio.Queue()
    token = _request_log_queue.set(q)

    DONE: dict[str, Any] = {"type": "__done__"}

    async def runner() -> None:
        try:
            result = await coro
            payload = (
                result.model_dump(mode="json") if isinstance(result, BaseModel) else result
            )
            await q.put({"type": "result", "data": payload})
        except Exception as e:
            logging.getLogger(__name__).exception("Streamed handler raised")
            await q.put({"type": "error", "msg": f"{type(e).__name__}: {e}"})
        finally:
            await q.put(DONE)

    task = asyncio.create_task(runner())

    try:
        while True:
            item = await q.get()
            if item is DONE:
                break
            yield (json.dumps(item, default=str) + "\n").encode("utf-8")
    finally:
        _request_log_queue.reset(token)
        if not task.done():
            task.cancel()
            try:
                await task
            except BaseException:
                pass
