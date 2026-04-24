"""Hero-media generation flow.

Claude (small model) drafts the image prompt from current HTML + user intent →
MiniMax renders the asset → Claude (larger model) rewrites the HTML to use
the new asset → mutator clones the parent tree, writes the new index.html and
the media file, produces a new variant node.

Two flavors of the same work:
- `POST /nodes/{id}/media`            — synchronous, blocks ~45-60s, legacy
  (kept for curl/debug); returns the final node payload when done
- `POST /nodes/{id}/media/jobs`       — enqueues the job, returns `{job_id}`
  immediately; clients then subscribe to
- `GET  /media/jobs/{job_id}/stream`  — SSE stream emitting structured events
  as each stage lands (`prompt-drafted`, `media-rendered`, `html-rewritten`,
  `node-ready`, `done` / `error`). See PLAN.md §25.1 task 4.

The streaming path is the default in the UI; the sync path is the fallback.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api import jobs
from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import SessionLocal, get_session
from atelier_api.providers import claude as claude_provider
from atelier_api.providers import minimax as media_provider
from atelier_api.routes.fork import FORK_SYSTEM, _parse_llm_output
from atelier_api.sandbox.mutator import apply_html_override, clone_tree
from atelier_api.storage import storage

log = logging.getLogger(__name__)

router = APIRouter(tags=["media"])


PROMPT_DRAFT_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are an art director writing a single image-generation prompt. "
            "Given an HTML document and a user intent, identify the hero region "
            "(usually the first <header> or first large <section>) and produce a "
            "single descriptive prompt suitable for a text-to-image model "
            "(MiniMax image-01).\n\n"
            "Rules:\n"
            "1. The prompt must describe imagery only — composition, lighting, subject, mood, style.\n"
            "2. Match the existing visual tone of the page (palette, formality, audience) unless the user intent overrides.\n"
            "3. Aim for 25-60 words. No bullet points. No 'a photo of' preambles. Just the descriptive prompt.\n"
            '4. Return strict JSON: {"image_prompt": "...", "reasoning": "one sentence why this fits"}.\n'
            "5. Output the JSON object and nothing else (no fences, no commentary).\n"
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


class MediaIn(BaseModel):
    kind: str = Field("image", pattern="^(image|video)$")
    user_intent: str | None = Field(None, max_length=2000)
    image_model: str = "image-01"
    video_model: str = "T2V-01-Director"
    aspect: str = "16:9"
    drafter_model: str = "haiku"
    rewriter_model: str = "sonnet"


class MediaChildOut(BaseModel):
    node_id: str
    edge_id: str
    title: str | None
    summary: str | None
    build_status: str
    sandbox_url: str | None
    image_prompt: str
    media_url: str
    media_is_mock: bool
    model_used: str
    token_usage: dict


class MediaJobOut(BaseModel):
    job_id: str
    stream_url: str


def _parse_drafter_json(text: str) -> dict:
    """Tolerant JSON extraction. Strips fences, hunts for first {...}."""
    cleaned = re.sub(r"^```(?:json)?\s*", "", text.strip())
    cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                pass
    return {}


# ─── Core pipeline (shared by sync and async paths) ──────────────────────────


async def _run_pipeline(
    session: AsyncSession,
    parent: Node,
    parent_html: str,
    project: Project | None,
    body: MediaIn,
    job_id: str | None = None,
) -> tuple[Node, Edge, str, Any, str]:
    """Run the full Claude → MiniMax → Claude pipeline.

    If `job_id` is provided, emits SSE events at each stage via `jobs.emit`.
    Returns (new_node, edge, image_prompt, media, relative_media_url).

    Caller is responsible for committing the session.
    """
    context_text = (project.settings or {}).get("context") if project else None
    intent = body.user_intent or "produce a hero image that fits the existing page tone and improves visual appeal"

    # ── Step 1: Claude drafts the image prompt ────────────────────────────────
    drafter_user = (
        (f"USER CONTEXT (project preferences):\n{context_text.strip()}\n\n" if context_text else "")
        + f"USER INTENT:\n{intent}\n\n"
        + f"HTML (truncated):\n```html\n{parent_html[:30000]}\n```\n\n"
        + 'Return JSON only: {"image_prompt": "...", "reasoning": "..."}'
    )
    if job_id:
        await jobs.emit(job_id, "drafting-prompt", {"model": body.drafter_model})
    draft_started = time.time()
    draft_resp = await claude_provider.call(
        system=PROMPT_DRAFT_SYSTEM,
        user=drafter_user,
        model=body.drafter_model,
        max_tokens=512,
    )
    draft = _parse_drafter_json(draft_resp.text)
    image_prompt = (draft.get("image_prompt") or "").strip() or intent
    drafter_reasoning = (draft.get("reasoning") or "").strip()
    if job_id:
        await jobs.emit(
            job_id,
            "prompt-drafted",
            {
                "image_prompt": image_prompt,
                "reasoning": drafter_reasoning,
                "elapsed_ms": int((time.time() - draft_started) * 1000),
                "token_usage": draft_resp.usage_dict,
            },
        )

    # ── Step 2: allocate the new node row so we have its id for paths ─────────
    new_node = Node(
        project_id=parent.project_id,
        parent_id=parent.id,
        type="variant",
        title=None,
        summary=None,
        created_by="agent",
        position_x=parent.position_x + 280.0,
        position_y=parent.position_y + 260.0,
        build_status="building",
    )
    session.add(new_node)
    await session.flush()
    if job_id:
        await jobs.emit(job_id, "node-allocated", {"node_id": new_node.id})

    variant_dir = settings.assets_path / "variants" / new_node.id
    staging_dir = Path(tempfile.mkdtemp(prefix=f"atelier-media-{new_node.id}-"))

    # ── Step 3: MiniMax renders (or mock) ─────────────────────────────────────
    if job_id:
        await jobs.emit(
            job_id,
            "rendering-media",
            {"kind": body.kind, "model": body.video_model if body.kind == "video" else body.image_model},
        )
    media_started = time.time()
    try:
        if body.kind == "video":
            media = await media_provider.generate_video(
                prompt=image_prompt,
                target_dir=staging_dir,
                model=body.video_model,
                aspect=body.aspect,
            )
        else:
            results = await media_provider.generate_image(
                prompt=image_prompt,
                target_dir=staging_dir,
                model=body.image_model,
                n=1,
                aspect=body.aspect,
            )
            if not results:
                raise RuntimeError("MiniMax returned zero images")
            media = results[0]
    except Exception as e:
        shutil.rmtree(staging_dir, ignore_errors=True)
        new_node.build_status = "error"
        new_node.summary = f"media generation failed: {e}"
        await session.commit()
        raise RuntimeError(f"MiniMax generation failed: {e}") from e

    media_filename = media.local_path.name if media.local_path else "hero.png"
    relative_media_url = f"media/{media_filename}"
    if job_id:
        await jobs.emit(
            job_id,
            "media-rendered",
            {
                "is_mock": media.is_mock,
                "model": media.model,
                "elapsed_ms": int((time.time() - media_started) * 1000),
                "size_bytes": (media.usage or {}).get("size_bytes"),
            },
        )

    # ── Step 4: Claude rewrites the HTML to use the new asset ─────────────────
    is_video_real = (body.kind == "video") and (not media.is_mock)
    asset_instruction = (
        f"REPLACE the hero/banner imagery so it uses the asset at the relative URL "
        f"`{relative_media_url}`. "
        + (
            f'Render it as a `<video src="{relative_media_url}" autoplay muted loop playsinline>` '
            "covering the hero area; preserve any overlay text and CTAs."
            if is_video_real
            else f'Render it as an `<img src="{relative_media_url}" alt="">` covering the hero area '
            "(use object-fit: cover and reasonable dimensions); preserve any overlay text and CTAs."
        )
        + " Also: REMOVE any existing <base> tag from <head> — our sandbox resolves "
        "relative URLs against the variant root, and a leftover <base> would "
        "hijack the new asset URL."
    )
    context_block = (
        f"USER CONTEXT (project preferences, audience, brand notes — respect these):\n{context_text.strip()}\n\n"
        if context_text and context_text.strip()
        else ""
    )
    rewriter_user = (
        f"{context_block}INSTRUCTION:\n{intent}\n\nADDITIONAL HARD REQUIREMENT:\n{asset_instruction}\n\n"
        f"PARENT_HTML (truncated if long):\n```html\n{parent_html[:60000]}\n```\n\n"
        "Now produce the modified HTML document followed by ---META--- and the JSON meta."
    )
    if job_id:
        await jobs.emit(job_id, "rewriting-html", {"model": body.rewriter_model})
    rewrite_started = time.time()
    rewrite_resp = await claude_provider.call(
        system=FORK_SYSTEM,
        user=rewriter_user,
        model=body.rewriter_model,
        max_tokens=8192,
    )
    new_html, meta = _parse_llm_output(rewrite_resp.text)
    if job_id:
        await jobs.emit(
            job_id,
            "html-rewritten",
            {
                "title": meta.get("title"),
                "summary": meta.get("summary"),
                "elapsed_ms": int((time.time() - rewrite_started) * 1000),
                "token_usage": rewrite_resp.usage_dict,
            },
        )

    # ── Step 5: Materialize the variant ───────────────────────────────────────
    if job_id:
        await jobs.emit(job_id, "uploading", {"node_id": new_node.id})
    upload_started = time.time()
    try:
        clone_tree(Path(parent.build_path), variant_dir)
        target_media_dir = variant_dir / "media"
        target_media_dir.mkdir(parents=True, exist_ok=True)
        if media.local_path and media.local_path.exists():
            shutil.move(str(media.local_path), str(target_media_dir / media_filename))
        shutil.rmtree(staging_dir, ignore_errors=True)
        apply_html_override(variant_dir, new_html)
        new_node.artifact_path = str(variant_dir)
        new_node.build_path = str(variant_dir)
        await storage.upload_variant_tree(new_node.id, variant_dir)
        new_node.build_status = "ready"
    except Exception as e:
        shutil.rmtree(staging_dir, ignore_errors=True)
        new_node.build_status = "error"
        new_node.summary = f"variant build failed: {e}"
        await session.commit()
        raise RuntimeError(f"Variant build failed: {e}") from e

    # ── Step 6: Stamp metadata + edge ─────────────────────────────────────────
    new_node.title = meta.get("title") or "Hero media variant"
    new_node.summary = meta.get("summary") or f"Generated {body.kind} hero from intent: {intent[:80]}"
    new_node.reasoning = {
        "user_intent": intent,
        "image_prompt": image_prompt,
        "drafter_reasoning": drafter_reasoning,
        "rewriter_reasoning": meta.get("reasoning", ""),
        "kind": body.kind,
        "media_is_mock": media.is_mock,
    }
    new_node.model_used = rewrite_resp.model
    new_node.token_usage = {
        **rewrite_resp.usage_dict,
        "drafter": draft_resp.usage_dict,
        "drafter_model": draft_resp.model,
        "minimax": media.usage_dict,
    }
    new_node.meta = {
        **(new_node.meta or {}),
        "media_assets": [
            {
                "type": body.kind,
                "url": relative_media_url,
                "filename": media_filename,
                "prompt": image_prompt,
                "model": media.model,
                "is_mock": media.is_mock,
                "cost_cents": media.cost_cents,
            }
        ],
    }

    edge = Edge(
        from_node_id=parent.id,
        to_node_id=new_node.id,
        type="prompt",
        prompt_text=f"[hero-media:{body.kind}] {intent}",
        reasoning={
            "image_prompt": image_prompt,
            "drafter_reasoning": drafter_reasoning,
        },
    )
    session.add(edge)
    await session.flush()

    if job_id:
        await jobs.emit(
            job_id,
            "uploaded",
            {"elapsed_ms": int((time.time() - upload_started) * 1000)},
        )

    return new_node, edge, image_prompt, media, relative_media_url


def _child_out(new_node: Node, edge: Edge, image_prompt: str, media, relative_media_url: str) -> MediaChildOut:
    return MediaChildOut(
        node_id=new_node.id,
        edge_id=edge.id,
        title=new_node.title,
        summary=new_node.summary,
        build_status=new_node.build_status,
        sandbox_url=storage.variant_url(new_node.id) if new_node.build_status == "ready" else None,
        image_prompt=image_prompt,
        media_url=storage.variant_url(new_node.id, relative_media_url),
        media_is_mock=media.is_mock,
        model_used=new_node.model_used or "",
        token_usage=new_node.token_usage or {},
    )


# ─── Sync endpoint (legacy) ──────────────────────────────────────────────────


@router.post("/nodes/{parent_id}/media", response_model=MediaChildOut)
async def generate_media_variant(
    parent_id: str,
    body: MediaIn,
    session: AsyncSession = Depends(get_session),
):
    parent = await session.get(Node, parent_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent node not found")
    if not parent.build_path:
        raise HTTPException(status_code=400, detail="Parent has no artifact to base media on. Re-seed the project.")

    parent_index = Path(parent.build_path) / "index.html"
    if not parent_index.exists():
        raise HTTPException(status_code=500, detail=f"Parent index.html missing at {parent_index}")
    parent_html = parent_index.read_text(encoding="utf-8")
    project = await session.get(Project, parent.project_id)

    try:
        new_node, edge, image_prompt, media, rel = await _run_pipeline(
            session=session, parent=parent, parent_html=parent_html, project=project, body=body
        )
    except RuntimeError as e:
        # _run_pipeline commits the error node before re-raising.
        raise HTTPException(status_code=502, detail=str(e))

    await session.commit()
    return _child_out(new_node, edge, image_prompt, media, rel)


# ─── Async endpoint (streaming) ──────────────────────────────────────────────


async def _run_media_job_bg(job_id: str, parent_id: str, body: MediaIn) -> None:
    """Background task that owns its own DB session."""
    try:
        async with SessionLocal() as session:
            parent = await session.get(Node, parent_id)
            if not parent:
                await jobs.emit(job_id, "error", {"message": "Parent node not found", "stage": "lookup"})
                await jobs.emit(job_id, "done", {"ok": False})
                return
            if not parent.build_path:
                await jobs.emit(
                    job_id,
                    "error",
                    {"message": "Parent has no artifact to base media on. Re-seed the project.", "stage": "lookup"},
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return

            parent_index = Path(parent.build_path) / "index.html"
            if not parent_index.exists():
                await jobs.emit(
                    job_id,
                    "error",
                    {"message": f"Parent index.html missing at {parent_index}", "stage": "lookup"},
                )
                await jobs.emit(job_id, "done", {"ok": False})
                return

            parent_html = parent_index.read_text(encoding="utf-8")
            project = await session.get(Project, parent.project_id)

            try:
                new_node, edge, image_prompt, media, rel = await _run_pipeline(
                    session=session,
                    parent=parent,
                    parent_html=parent_html,
                    project=project,
                    body=body,
                    job_id=job_id,
                )
            except RuntimeError as e:
                log.exception("media job failed")
                await jobs.emit(job_id, "error", {"message": str(e), "stage": "pipeline"})
                await jobs.emit(job_id, "done", {"ok": False})
                return

            await session.commit()
            child = _child_out(new_node, edge, image_prompt, media, rel)
            await jobs.emit(job_id, "node-ready", child.model_dump())
            await jobs.emit(job_id, "done", {"ok": True})
    except Exception as e:  # pragma: no cover — defensive
        log.exception("media job crashed")
        await jobs.emit(job_id, "error", {"message": f"Unexpected: {e}", "stage": "task"})
        await jobs.emit(job_id, "done", {"ok": False})
    finally:
        await jobs.retire(job_id)


@router.post("/nodes/{parent_id}/media/jobs", response_model=MediaJobOut)
async def enqueue_media_job(parent_id: str, body: MediaIn):
    job_id = jobs.new_job_id()
    jobs.register_job(job_id)
    # Emit a job-started marker BEFORE kicking off so an SSE subscriber that
    # connects during the first few ms still sees it.
    await jobs.emit(job_id, "job-started", {"parent_id": parent_id, "kind": body.kind})
    asyncio.create_task(_run_media_job_bg(job_id, parent_id, body))
    return MediaJobOut(job_id=job_id, stream_url=f"/api/v1/media/jobs/{job_id}/stream")


# ─── SSE stream ──────────────────────────────────────────────────────────────


_SSE_HEADERS = {
    # Disable buffering on proxies (Render uses Cloudflare in front).
    "Cache-Control": "no-cache, no-transform",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}


@router.get("/media/jobs/{job_id}/stream")
async def stream_media_job(job_id: str, request: Request):
    q = jobs.get_queue(job_id)
    if q is None:
        raise HTTPException(status_code=404, detail="Unknown or retired job_id")

    async def event_source() -> AsyncIterator[bytes]:
        # Comment heartbeat first flush (makes proxies release buffers fast).
        yield b": connected\n\n"
        while True:
            if await request.is_disconnected():
                log.info("sse client disconnected job_id=%s", job_id)
                return
            try:
                payload = await asyncio.wait_for(q.get(), timeout=15.0)
            except asyncio.TimeoutError:
                # Keep-alive ping so intermediate proxies don't close us.
                yield b": ping\n\n"
                continue
            yield f"data: {json.dumps(payload)}\n\n".encode("utf-8")
            if payload.get("type") == "done":
                return

    return StreamingResponse(event_source(), headers=_SSE_HEADERS)
