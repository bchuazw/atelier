"""Keep-warm pinger.

Render's free-tier web services sleep after 15 minutes of no HTTP traffic
and need ~30 seconds to cold-start. For a live-demoed URL that's a
painful first-impression gap.

This module runs a small background task inside the API process that
hits its own `/healthz` and the sandbox-server's `/healthz` on a timer.
Both stay awake as long as the API is serving requests — which it will
be, because we also ping ourselves. The net effect: once something
wakes the API (a judge clicking the URL), all three services stay warm
for the rest of the session.

Controlled by ATELIER_KEEPWARM_URLS (comma-separated). Disabled by
default; the hosted service sets it to point at both its own URL and
the sandbox proxy URL.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Iterable

import httpx

log = logging.getLogger(__name__)

DEFAULT_INTERVAL_SEC = 10 * 60  # 10 minutes (Render sleeps at 15)


def _urls_from_env() -> list[str]:
    raw = os.environ.get("ATELIER_KEEPWARM_URLS", "")
    return [u.strip().rstrip("/") for u in raw.split(",") if u.strip()]


async def _ping_once(client: httpx.AsyncClient, url: str) -> None:
    try:
        r = await client.get(url, timeout=20.0)
        log.info("[keepwarm] %s -> %d", url, r.status_code)
    except Exception as e:
        log.warning("[keepwarm] %s failed: %s", url, e)


async def keepwarm_loop(urls: Iterable[str], interval_sec: float = DEFAULT_INTERVAL_SEC) -> None:
    urls = list(urls)
    if not urls:
        log.info("[keepwarm] no URLs configured; loop exiting")
        return
    log.info("[keepwarm] pinging %s every %ds", urls, int(interval_sec))
    async with httpx.AsyncClient() as client:
        # Small jitter-free stagger so we don't dogpile on startup.
        await asyncio.sleep(30)
        while True:
            for url in urls:
                await _ping_once(client, url)
            await asyncio.sleep(interval_sec)


def start_keepwarm(app) -> asyncio.Task | None:
    """Schedule the loop as a background task. Returns the task so the caller
    can cancel it during shutdown."""
    urls = _urls_from_env()
    if not urls:
        return None
    return asyncio.create_task(keepwarm_loop(urls), name="atelier-keepwarm")
