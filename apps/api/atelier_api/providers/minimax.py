"""MiniMax provider — image + video generation for the hero-media flow.

Why MiniMax: Genspark (original plan) does not expose a public API. MiniMax's
Hailuo / Image-01 + T2V-01 family covers the same ground (text-to-image +
short text-to-video) with a documented HTTP API.

API shape (platform.minimax.io/docs):

- Image (sync):  POST /v1/image_generation       returns {data: {image_urls: [...]}}
- Video (async): POST /v1/video_generation       returns {task_id}
                 GET  /v1/query/video_generation returns {status, file_id}
                 GET  /v1/files/retrieve         returns {file: {download_url}}

Auth: Bearer <api_key>. When MINIMAX_API_KEY is empty we return a labeled SVG
placeholder so the hero-media flow still exercises in dev without billing.
"""
from __future__ import annotations

import asyncio
import logging
import os
import uuid
from pathlib import Path
from typing import Any

import httpx

from atelier_api.config import settings

from .base import LlmResponse, MediaResponse

log = logging.getLogger(__name__)

DEFAULT_BASE_URL = "https://api.minimax.io"
DEFAULT_IMAGE_MODEL = "image-01"
DEFAULT_VIDEO_MODEL = "T2V-01-Director"

_MOCK_PALETTE = [
    ("#FFB347", "#FF6961"),
    ("#84A9C0", "#3A6B8C"),
    ("#A8E6CF", "#56AB91"),
    ("#C9B6E4", "#7B5EA7"),
]


def _resolve_key(api_key: str | None) -> str:
    return (
        api_key
        or os.environ.get("MINIMAX_API_KEY")
        or getattr(settings, "minimax_api_key", "")
        or ""
    )


def _resolve_base_url() -> str:
    return os.environ.get("MINIMAX_BASE_URL") or getattr(
        settings, "minimax_base_url", DEFAULT_BASE_URL
    )


def is_mock_mode(api_key: str | None = None) -> bool:
    return not _resolve_key(api_key)


def _mock_svg(prompt: str, seed: int, width: int = 1600, height: int = 900) -> str:
    c1, c2 = _MOCK_PALETTE[seed % len(_MOCK_PALETTE)]
    safe = (prompt or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")[:140]
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="g{seed}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="{c1}"/>
      <stop offset="100%" stop-color="{c2}"/>
    </linearGradient>
  </defs>
  <rect width="{width}" height="{height}" fill="url(#g{seed})"/>
  <text x="60" y="120" font-family="system-ui, sans-serif" font-size="56" font-weight="700" fill="rgba(255,255,255,0.95)">
    [minimax-mock]
  </text>
  <text x="60" y="200" font-family="system-ui, sans-serif" font-size="28" fill="rgba(255,255,255,0.85)">
    Set MINIMAX_API_KEY to render real imagery.
  </text>
  <text x="60" y="{height - 80}" font-family="system-ui, sans-serif" font-size="22" fill="rgba(255,255,255,0.75)">
    prompt: {safe}
  </text>
</svg>
"""


def _aspect_to_dims(aspect: str) -> tuple[int, int]:
    return {
        "16:9": (1600, 900),
        "4:3": (1600, 1200),
        "1:1": (1200, 1200),
        "9:16": (900, 1600),
        "3:4": (1200, 1600),
    }.get(aspect, (1600, 900))


async def generate_image(
    *,
    prompt: str,
    target_dir: Path,
    model: str = DEFAULT_IMAGE_MODEL,
    n: int = 1,
    aspect: str = "16:9",
    api_key: str | None = None,
) -> list[MediaResponse]:
    target_dir.mkdir(parents=True, exist_ok=True)

    if is_mock_mode(api_key):
        log.info("[minimax-mock] generate_image n=%d prompt=%r", n, prompt[:80])
        width, height = _aspect_to_dims(aspect)
        results: list[MediaResponse] = []
        for i in range(n):
            seed = (uuid.uuid4().int + i) & 0xFFFFFFFF
            path = target_dir / f"mock-{seed:08x}.svg"
            path.write_text(_mock_svg(prompt, seed, width, height), encoding="utf-8")
            results.append(
                MediaResponse(
                    url=path.as_posix(),
                    local_path=path,
                    model=f"mock-{model}",
                    prompt=prompt,
                    kind="image",
                    is_mock=True,
                    cost_cents=0,
                    usage={"width": width, "height": height, "aspect": aspect},
                )
            )
        return results

    base_url = _resolve_base_url().rstrip("/")
    headers = {
        "Authorization": f"Bearer {_resolve_key(api_key)}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "prompt": prompt,
        "aspect_ratio": aspect,
        "n": n,
        "response_format": "url",
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        resp = await client.post(f"{base_url}/v1/image_generation", json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

        base = data.get("base_resp") or {}
        if base.get("status_code") not in (0, None):
            raise RuntimeError(
                f"MiniMax image error: {base.get('status_code')} {base.get('status_msg')}"
            )

        urls = ((data.get("data") or {}).get("image_urls")) or []
        if not urls:
            raise RuntimeError(f"MiniMax returned no image URLs: {data!r}")

        results = []
        for i, remote_url in enumerate(urls):
            ext = Path(remote_url.split("?")[0]).suffix or ".jpg"
            local = target_dir / f"hero-{i:02d}{ext}"
            img_resp = await client.get(remote_url)
            img_resp.raise_for_status()
            local.write_bytes(img_resp.content)
            results.append(
                MediaResponse(
                    url=local.as_posix(),
                    local_path=local,
                    model=model,
                    prompt=prompt,
                    kind="image",
                    is_mock=False,
                    cost_cents=None,  # MiniMax doesn't return per-call cost
                    usage={
                        "remote_url": remote_url,
                        "request_id": data.get("id"),
                        "size_bytes": len(img_resp.content),
                    },
                )
            )
        return results


async def generate_video(
    *,
    prompt: str,
    target_dir: Path,
    model: str = DEFAULT_VIDEO_MODEL,
    duration: int = 6,
    aspect: str = "16:9",
    api_key: str | None = None,
) -> MediaResponse:
    """Short MiniMax text-to-video. Async: submit → poll → download file.

    Typical wall time: 60-180s. Caller is responsible for wrapping with a
    reasonable user-facing progress indicator.
    """
    target_dir.mkdir(parents=True, exist_ok=True)

    if is_mock_mode(api_key):
        log.info("[minimax-mock] generate_video prompt=%r", prompt[:80])
        width, height = _aspect_to_dims(aspect)
        seed = uuid.uuid4().int & 0xFFFFFFFF
        path = target_dir / f"mock-video-{seed:08x}.svg"
        path.write_text(_mock_svg(prompt, seed, width, height), encoding="utf-8")
        return MediaResponse(
            url=path.as_posix(),
            local_path=path,
            model=f"mock-{model}",
            prompt=prompt,
            kind="video-mock-as-image",
            is_mock=True,
            cost_cents=0,
            usage={"duration": duration, "aspect": aspect},
        )

    base_url = _resolve_base_url().rstrip("/")
    key = _resolve_key(api_key)
    headers_json = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    headers_plain = {"Authorization": f"Bearer {key}"}

    async with httpx.AsyncClient(timeout=600.0) as client:
        # 1. Kick off the job.
        r = await client.post(
            f"{base_url}/v1/video_generation",
            json={"model": model, "prompt": prompt},
            headers=headers_json,
        )
        r.raise_for_status()
        submit = r.json()
        if (submit.get("base_resp") or {}).get("status_code") not in (0, None):
            raise RuntimeError(f"MiniMax video submit error: {submit!r}")
        task_id = submit.get("task_id")
        if not task_id:
            raise RuntimeError(f"MiniMax video returned no task_id: {submit!r}")

        # 2. Poll up to 5 minutes, every 5s.
        file_id: str | None = None
        for _ in range(60):
            await asyncio.sleep(5)
            q = await client.get(
                f"{base_url}/v1/query/video_generation",
                params={"task_id": task_id},
                headers=headers_plain,
            )
            q.raise_for_status()
            qd = q.json()
            status = qd.get("status")
            if status == "Success":
                file_id = qd.get("file_id")
                break
            if status == "Fail":
                raise RuntimeError(f"MiniMax video task failed: {qd!r}")

        if not file_id:
            raise RuntimeError(f"MiniMax video task {task_id} did not complete within timeout")

        # 3. Retrieve the download URL.
        f = await client.get(
            f"{base_url}/v1/files/retrieve",
            params={"file_id": file_id},
            headers=headers_plain,
        )
        f.raise_for_status()
        file_info = f.json().get("file") or {}
        download_url = file_info.get("download_url")
        if not download_url:
            raise RuntimeError(f"MiniMax file {file_id} has no download_url: {file_info!r}")

        # 4. Stream the MP4 to disk.
        vresp = await client.get(download_url)
        vresp.raise_for_status()
        local = target_dir / "hero-motion.mp4"
        local.write_bytes(vresp.content)
        return MediaResponse(
            url=local.as_posix(),
            local_path=local,
            model=model,
            prompt=prompt,
            kind="video",
            is_mock=False,
            cost_cents=None,
            usage={
                "task_id": task_id,
                "file_id": file_id,
                "size_bytes": len(vresp.content),
                "duration": duration,
            },
        )


async def chat_with_search(
    *,
    system: str,
    user: str,
    model: str = "abab6.5-chat",
    api_key: str | None = None,
) -> LlmResponse:
    """Not used in v1 — kept so /media imports remain stable if we wire web search later."""
    return LlmResponse(
        text=f"[minimax] chat_with_search not wired. echo: {user[:200]}",
        model=f"stub-{model}",
    )
