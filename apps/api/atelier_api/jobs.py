"""In-memory per-process job event bus.

Background asyncio tasks push structured events into a job-scoped queue;
an SSE endpoint reads from the same queue and streams events to the browser.

Why in-memory instead of a DB-backed `refinement_job` table:
- Single-instance Render free tier, no cross-process consumers
- Events are ephemeral — once the node lands on the canvas, the history stops
  mattering. If we later scale to multi-instance we'll swap this for Redis
  pub/sub without touching the event shape
- One less schema migration to manage while we still lack Alembic

Events are just dicts. The canonical shape:
    {"type": "<event-name>", "ts": 1234567890.123, "data": {...}}

Retirement: after a terminal event ("done" | "error") the queue is kept
around for a grace period so a slow browser can still drain it, then GC'd.
"""
from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

log = logging.getLogger(__name__)

# Job id → queue. Bounded so a stuck consumer can't leak unbounded memory.
_queues: dict[str, asyncio.Queue] = {}
_retire_delay_sec = 30.0
_max_queue_items = 500


def new_job_id() -> str:
    return str(uuid.uuid4())


def register_job(job_id: str) -> asyncio.Queue:
    """Call this from the producer BEFORE starting the background task so the
    SSE subscriber has something to attach to even if it connects before the
    first emit."""
    if job_id in _queues:
        return _queues[job_id]
    q: asyncio.Queue = asyncio.Queue(maxsize=_max_queue_items)
    _queues[job_id] = q
    return q


def get_queue(job_id: str) -> asyncio.Queue | None:
    return _queues.get(job_id)


async def emit(job_id: str, event_type: str, data: dict[str, Any] | None = None) -> None:
    q = _queues.get(job_id)
    if q is None:
        log.warning("emit on unknown job_id=%s event=%s (dropped)", job_id, event_type)
        return
    payload = {"type": event_type, "ts": time.time(), "data": data or {}}
    try:
        q.put_nowait(payload)
    except asyncio.QueueFull:
        log.warning("job_id=%s queue full, event dropped: %s", job_id, event_type)


async def retire(job_id: str, delay_sec: float = _retire_delay_sec) -> None:
    """Schedule a queue deletion. Call after emitting `done` or `error`."""

    async def _gc():
        await asyncio.sleep(delay_sec)
        _queues.pop(job_id, None)
        log.debug("job_id=%s retired", job_id)

    asyncio.create_task(_gc())
