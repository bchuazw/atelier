from __future__ import annotations

import json
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.config import settings
from atelier_api.db.models import Node, now_iso
from atelier_api.db.session import get_session
from atelier_api.llm import client as llm
from atelier_api.pricing import cost_cents_for_usage, project_total_cost_cents
from atelier_api.storage import storage


async def _ensure_node_on_disk(node: Node):
    """Local import to avoid circular deps at module load."""
    from atelier_api.routes.media import _ensure_parent_materialized

    return await _ensure_parent_materialized(node)

router = APIRouter(prefix="/nodes", tags=["nodes"])


class NodePatchIn(BaseModel):
    position_x: float | None = None
    position_y: float | None = None
    pinned: int | None = None
    title: str | None = None


@router.get("/{node_id}")
async def get_node(node_id: str, session: AsyncSession = Depends(get_session)):
    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return {
        "id": node.id,
        "project_id": node.project_id,
        "parent_id": node.parent_id,
        "type": node.type,
        "title": node.title,
        "summary": node.summary,
        "reasoning": node.reasoning,
        "build_status": node.build_status,
        "model_used": node.model_used,
        "token_usage": node.token_usage,
        "position": {"x": node.position_x, "y": node.position_y},
        "sandbox_url": storage.variant_url(node.id) if node.build_status == "ready" else None,
        "created_at": node.created_at,
    }


@router.patch("/{node_id}")
async def patch_node(node_id: str, body: NodePatchIn, session: AsyncSession = Depends(get_session)):
    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if body.position_x is not None:
        node.position_x = body.position_x
    if body.position_y is not None:
        node.position_y = body.position_y
    if body.pinned is not None:
        node.pinned = body.pinned
    if body.title is not None:
        node.title = body.title
    await session.commit()
    return {"ok": True}


@router.delete("/{node_id}")
async def delete_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """Delete a single variant + every descendant under it.

    Seeds can't be deleted via this route (delete the project instead).
    Removes nodes from DB, drops associated edges, and best-effort cleans
    up the variant tree from object storage.
    """
    from sqlalchemy import select

    from atelier_api.db.models import Edge, Project

    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.type == "seed":
        raise HTTPException(
            status_code=400,
            detail="Can't delete the seed. Delete the project to remove the seed and all variants.",
        )

    # Walk the descendant subtree so we delete a node + all its forks +
    # their forks. parent_id is single-parent; merge edges (multi-parent)
    # are NOT followed here — a merge child whose `parent_id` is a
    # different node remains intact, just losing one of its contribution
    # edges below.
    project_id = node.project_id
    to_delete: list[str] = [node.id]
    frontier = [node.id]
    while frontier:
        current = frontier.pop()
        children = (
            await session.execute(select(Node.id).where(Node.parent_id == current))
        ).all()
        for (cid,) in children:
            if cid not in to_delete:
                to_delete.append(cid)
                frontier.append(cid)

    # Gather published slugs BEFORE the DB delete commits — we need to read
    # `node.reasoning` while the rows still exist. After commit, the Node
    # objects are gone and we'd lose the slug -> directory mapping.
    published_slugs: list[str] = []
    for nid in to_delete:
        n = await session.get(Node, nid)
        if n is None:
            continue
        meta = _read_published_meta(n)
        if meta and meta.get("slug"):
            published_slugs.append(meta["slug"])

    # If the working_node_id pointed at any node we're about to delete,
    # reset it so the project doesn't end up with a dangling reference.
    project = await session.get(Project, project_id)
    if project and project.working_node_id in to_delete:
        project.working_node_id = None
    if project and project.settings and project.settings.get("active_checkpoint_id") in to_delete:
        new_settings = dict(project.settings)
        new_settings.pop("active_checkpoint_id", None)
        project.settings = new_settings

    # Drop edges that point at any deleted node; SQLite without ON DELETE
    # CASCADE on every edge wouldn't pick up automatically.
    if to_delete:
        edges_to_remove = (
            await session.execute(
                select(Edge).where(
                    (Edge.from_node_id.in_(to_delete)) | (Edge.to_node_id.in_(to_delete))
                )
            )
        ).scalars().all()
        for e in edges_to_remove:
            await session.delete(e)

    for nid in to_delete:
        n = await session.get(Node, nid)
        if n is not None:
            await session.delete(n)
    await session.commit()

    # Best-effort storage cleanup; failures don't roll back the DB delete.
    cleaned = 0
    failed: list[str] = []
    for nid in to_delete:
        try:
            await storage.delete_variant_tree(nid)
            cleaned += 1
        except Exception as e:  # pragma: no cover — defensive
            failed.append(f"{nid}: {e}")

    # Best-effort published-tree cleanup. A stale `assets/published/<slug>/`
    # would otherwise outlive its source variant and continue serving at
    # `/p/<slug>/`. `rmtree(ignore_errors=True)` swallows missing dirs and
    # cross-filesystem quirks (Render mount, etc.). Failures are logged-not-
    # raised so they cannot roll back the DB delete.
    import shutil as _shutil
    import logging as _logging

    published_cleaned = 0
    for slug in published_slugs:
        target = settings.assets_path / "published" / slug
        try:
            if target.exists():
                _shutil.rmtree(target, ignore_errors=True)
            # Best-effort Supabase cleanup. Wrapped in the same try/except as
            # the local rmtree so a Supabase outage doesn't block the DB
            # delete from being acknowledged. A stale `published/<slug>/`
            # prefix in the bucket is harmless — it'll just keep serving
            # until manually removed or the slug is re-published (upsert).
            await storage.delete_published_tree(slug)
            published_cleaned += 1
        except Exception as e:  # pragma: no cover — defensive
            _logging.getLogger(__name__).warning(
                "published cleanup failed for slug=%s: %s", slug, e
            )

    return {
        "ok": True,
        "deleted": len(to_delete),
        "storage_cleaned": cleaned,
        "storage_failed": failed,
        "published_cleaned": published_cleaned,
    }


@router.get("/{node_id}/export")
async def export_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """Return everything needed to take this variant elsewhere.

    - `html`: the full index.html content
    - `media_assets`: list of {relative_path, public_url} for every file
      in the variant tree that isn't index.html (images, fonts, CSS, etc.)
      — useful when the user wants to download the whole tree, not just
      the HTML file.
    - `lineage`: compact breadcrumb (title, type) from root → this node
      so the user has context when pasting into Cursor or similar.
    """
    from pathlib import Path

    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.build_status != "ready":
        raise HTTPException(
            status_code=400, detail=f"Node build_status={node.build_status!r}; can't export."
        )
    try:
        node_dir = await _ensure_node_on_disk(node)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    html = (node_dir / "index.html").read_text(encoding="utf-8")

    # Enumerate non-HTML files for the media asset list.
    media_assets = []
    for p in sorted(node_dir.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(node_dir).as_posix()
        if rel == "index.html":
            continue
        media_assets.append(
            {
                "relative_path": rel,
                "public_url": storage.variant_url(node_id, rel),
                "size_bytes": p.stat().st_size,
            }
        )

    # Walk lineage back to root (capped).
    lineage: list[dict] = []
    current = node
    for _ in range(12):
        lineage.insert(
            0,
            {"id": current.id, "title": current.title, "type": current.type, "model_used": current.model_used},
        )
        if not current.parent_id:
            break
        parent = await session.get(Node, current.parent_id)
        if not parent:
            break
        current = parent

    return {
        "node_id": node.id,
        "title": node.title,
        "summary": node.summary,
        "html": html,
        "html_size_bytes": len(html),
        "media_assets": media_assets,
        "sandbox_url": storage.variant_url(node.id),
        "lineage": lineage,
    }


@router.get("/{node_id}/export/zip")
async def export_node_zip(node_id: str, session: AsyncSession = Depends(get_session)):
    """Bundle the entire variant tree (index.html + all assets) as a zip.

    Returned as `application/zip` with Content-Disposition so the browser
    downloads it. Useful when a variant references generated media (hero
    images, etc.) and the user wants the complete package for Cursor /
    their editor without grabbing each file separately.
    """
    import io
    import zipfile

    from fastapi.responses import StreamingResponse

    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.build_status != "ready":
        raise HTTPException(
            status_code=400, detail=f"Node build_status={node.build_status!r}; can't export."
        )
    try:
        node_dir = await _ensure_node_on_disk(node)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Build zip in memory. Variants are small (HTML + 1 media file, typically
    # < 2 MB), so holding in memory is fine.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(node_dir.rglob("*")):
            if not p.is_file():
                continue
            rel = p.relative_to(node_dir).as_posix()
            zf.write(p, arcname=rel)
    buf.seek(0)

    safe_title = (node.title or "atelier-variant").replace('"', "").replace("/", "-")
    safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in safe_title)[:80].strip() or "atelier-variant"
    filename = f"{safe_title}.zip"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )


REACT_EXPORT_SYSTEM = [
    {
        "type": "text",
        "text": (
            "You are a senior frontend engineer. Convert a single HTML document into a clean, "
            "Vite-compatible React + TypeScript project. Split the page into one functional "
            "component per logical section (Hero, Features, Footer, etc.). Use Tailwind CSS "
            "for styling — extract any inline `<style>` rules into the component classes. "
            "Do NOT add routing, state management, or any extra runtime libraries.\n\n"
            "Output a SINGLE JSON object (no prose, no markdown fences) with shape:\n"
            "{ \"files\": { \"src/App.tsx\": \"...\", \"src/components/Hero.tsx\": \"...\", "
            "\"package.json\": \"...\", \"index.html\": \"...\", \"tailwind.config.js\": \"...\", "
            "\"postcss.config.js\": \"...\", \"src/main.tsx\": \"...\", \"src/index.css\": \"...\", "
            "\"vite.config.ts\": \"...\", \"tsconfig.json\": \"...\" } }\n\n"
            "Rules:\n"
            "1. Every file path is repo-relative (forward slashes).\n"
            "2. File contents are plain strings — escape newlines as \\n inside JSON.\n"
            "3. `package.json` declares react, react-dom, vite, @vitejs/plugin-react, "
            "tailwindcss, postcss, autoprefixer, typescript. No other deps.\n"
            "4. Components use functional syntax + Tailwind classes; no inline styles unless "
            "the value is dynamic.\n"
            "5. Preserve copy, image URLs, and section ordering from the source HTML. "
            "Keep absolute/relative asset URLs as-is.\n"
            "6. Return ONLY the JSON object. No leading/trailing prose. No code fences."
        ),
        "cache_control": {"type": "ephemeral"},
    }
]


def _parse_react_export_json(text: str) -> dict:
    """Strict JSON parse for the React-export response.

    The system prompt asks for a bare JSON object with no fences, but models
    sometimes wrap output in ```json``` anyway — strip a single fence layer
    before parsing so we don't fail on that one common deviation. Anything
    else that isn't valid JSON raises, and the caller turns it into HTTP 502.
    """
    cleaned = text.strip()
    fence = re.match(r"^```(?:json)?\s*(.*?)\s*```$", cleaned, re.DOTALL)
    if fence:
        cleaned = fence.group(1).strip()
    payload = json.loads(cleaned)
    if not isinstance(payload, dict) or "files" not in payload:
        raise ValueError("Response missing top-level `files` key")
    files = payload["files"]
    if not isinstance(files, dict) or not files:
        raise ValueError("`files` must be a non-empty object")
    for path, content in files.items():
        if not isinstance(path, str) or not isinstance(content, str):
            raise ValueError(
                f"Every file entry must be string->string; got {type(path).__name__}->{type(content).__name__}"
            )
    return payload


async def _project_cost_state(session: AsyncSession, project_id: str) -> tuple[int, int | None]:
    """Mirror of `routes.fork._project_cost_status` — kept local so this route
    file doesn't import from fork.py (would create a fan-out import). Returns
    (total_cost_cents, cost_cap_cents). Cap is None when unset.

    The total now includes prior React-export spend stored under
    `project.settings["cost_events"]` so a chain of React exports correctly
    accumulates against the cap (those calls don't persist a Node)."""
    from sqlalchemy import select

    from atelier_api.db.models import Project

    nodes = (
        (await session.execute(select(Node).where(Node.project_id == project_id))).scalars().all()
    )
    project = await session.get(Project, project_id)
    total = project_total_cost_cents(nodes, project=project)
    raw_cap = (project.settings or {}).get("cost_cap_cents") if project else None
    cap = int(raw_cap) if isinstance(raw_cap, (int, float)) and raw_cap > 0 else None
    return total, cap


async def _generate_react_files(node: Node, session: AsyncSession) -> dict:
    """Shared LLM-call path for both `/export/react` and `/export/react/zip`.

    Returns `{files, model_used, token_usage, cost_cents}`. Raises HTTPException
    on cost-cap overflow (402), invalid JSON from the model (502), or upstream
    Anthropic errors (500). The caller is responsible for shaping the response.
    """
    from pathlib import Path  # noqa: F401 — kept for parity with siblings

    if node.build_status != "ready":
        raise HTTPException(
            status_code=400, detail=f"Node build_status={node.build_status!r}; can't export."
        )
    try:
        node_dir = await _ensure_node_on_disk(node)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    # Cost-cap gate. Same shape as fork.py — reject pre-LLM if the project
    # is already at/over its cap. Sonnet output for an 8K-token rewrite is
    # measurable spend (~12-15c), so we don't want to surprise users.
    total_cents, cap_cents = await _project_cost_state(session, node.project_id)
    if cap_cents is not None and total_cents >= cap_cents:
        raise HTTPException(
            status_code=402,
            detail=(
                f"Project cost cap reached (${cap_cents / 100:.2f}). "
                "Raise the cap in Project Context to continue."
            ),
        )

    html = (node_dir / "index.html").read_text(encoding="utf-8")
    # Truncate the HTML at the same 60K char budget the fork prompt uses;
    # the React rewrite cares about structure, not tail content, and the
    # Sonnet input window is generous but not infinite.
    truncated_html = html[:60000]
    user_msg = (
        "Convert the following HTML document into a clean React + Tailwind project. "
        "Split into one component per logical section. Return JSON only.\n\n"
        f"```html\n{truncated_html}\n```"
    )

    try:
        resp = await llm.call(
            system=REACT_EXPORT_SYSTEM,
            user=user_msg,
            model="sonnet",
            max_tokens=8192,
        )
    except Exception as e:  # pragma: no cover — Anthropic upstream failure
        raise HTTPException(status_code=500, detail=f"LLM call failed: {e}")

    # Single-shot JSON parse → if it fails, try ONE corrective re-prompt
    # before giving up. A freelance-dev beta tester hit a 502 on her first
    # cold attempt (88s wasted), retried manually, and succeeded in 21s.
    # Doing the retry server-side means the user sees a slower-than-usual
    # success instead of a hard failure they have to act on. Both calls
    # sum into the project's cost rollup via the persistence block below.
    parse_error: Exception | None = None
    try:
        parsed = _parse_react_export_json(resp.text)
    except (json.JSONDecodeError, ValueError) as e:
        parse_error = e
        retry_msg = (
            "Your previous response was not valid JSON. The error was: "
            f"{e}\n\nFirst 400 chars of what you sent:\n{resp.text[:400]}\n\n"
            "Re-output the SAME React project as a single JSON object only. "
            "No prose, no markdown fences, no leading or trailing whitespace. "
            "Start with `{` and end with `}`."
        )
        try:
            resp_retry = await llm.call(
                system=REACT_EXPORT_SYSTEM,
                user=retry_msg,
                model="sonnet",
                max_tokens=8192,
            )
            parsed = _parse_react_export_json(resp_retry.text)
            # Aggregate the retry's tokens onto the original response so the
            # cost rollup sees BOTH calls (ensures the user's cap check is
            # honest about how much the JSON-parse retry actually cost).
            base = dict(resp.usage_dict or {})
            extra = resp_retry.usage_dict or {}
            for k in ("input", "output", "cache_read", "cache_creation"):
                base[k] = (base.get(k) or 0) + (extra.get(k) or 0)
            resp.usage_dict = base
            resp = resp_retry  # use the retry's text + model going forward
            resp.usage_dict = base
        except (json.JSONDecodeError, ValueError) as e2:
            raise HTTPException(
                status_code=502,
                detail=(
                    f"Model returned invalid JSON twice for React export. "
                    f"First: {parse_error}. Retry: {e2}. "
                    "Try again or split the page into smaller variants."
                ),
            )
        except Exception as e2:  # pragma: no cover — Anthropic upstream failure on retry
            raise HTTPException(
                status_code=502,
                detail=(
                    f"First call returned invalid JSON ({parse_error}); "
                    f"corrective retry failed: {e2}."
                ),
            )

    usage = resp.usage_dict
    cost_cents = cost_cents_for_usage(usage, resp.model)

    # Persist this spend as a project-level cost event so it rolls into
    # `project.total_cost_cents` (and therefore the cap check) on subsequent
    # calls. The React-export endpoint deliberately doesn't persist a Node,
    # so without this the spend would be invisible to the rollup.
    #
    # We re-fetch the project (rather than reusing the one from
    # `_project_cost_state`) because the LLM call may have taken several
    # seconds and the row might have changed underneath us — fork/critic
    # commits could have written to settings in the interim. SQLAlchemy
    # JSON columns don't dirty-track in-place mutations, so we build a new
    # dict + reassign and call `flag_modified` (same trick `publish_node`
    # uses for `node.reasoning`).
    from sqlalchemy.orm.attributes import flag_modified

    from atelier_api.db.models import Project

    project = await session.get(Project, node.project_id)
    if project is not None:
        new_settings = dict(project.settings or {})
        events = list(new_settings.get("cost_events") or [])
        events.append(
            {
                "type": "react_export",
                "node_id": node.id,
                "model": resp.model,
                "token_usage": usage,
                "cost_cents": int(cost_cents),
                "ts": now_iso(),
            }
        )
        # Cap retention so a long-lived project's settings JSON doesn't grow
        # unbounded. 200 events is generous for a single-user beta — at
        # ~12c/event that's $24 of React-export history before we start
        # dropping the oldest entries from the rollup.
        if len(events) > 200:
            events = events[-200:]
        new_settings["cost_events"] = events
        project.settings = new_settings
        flag_modified(project, "settings")
        await session.commit()

    return {
        "files": parsed["files"],
        "model_used": resp.model,
        "token_usage": usage,
        "cost_cents": cost_cents,
    }


@router.post("/{node_id}/export/react")
async def export_node_react(node_id: str, session: AsyncSession = Depends(get_session)):
    """One-shot Claude rewrite of the variant HTML into a multi-file React project.

    Returns `{files: {path: content}, model_used, token_usage, cost_cents}`.
    Costs roll up into the project total via the usual usage payload — but
    note this endpoint does NOT persist a Node, so the spend only counts on
    subsequent reads of the project tree if you choose to wire it up.
    """
    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    return await _generate_react_files(node, session)


@router.post("/{node_id}/export/react/zip")
async def export_node_react_zip(node_id: str, session: AsyncSession = Depends(get_session)):
    """Same Claude rewrite as `/export/react`, but streams a real .zip with the
    files placed at their declared paths. Uses POST (not GET) because the
    operation costs money and we don't want browsers prefetching it.
    """
    import io
    import zipfile

    from fastapi.responses import StreamingResponse

    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")

    result = await _generate_react_files(node, session)
    files: dict[str, str] = result["files"]

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_DEFLATED) as zf:
        for path, content in files.items():
            # Defense in depth: refuse paths that would escape the archive
            # root via `..` or absolute prefixes. Pretty much paranoia for
            # a single-user tool, but trivial to enforce.
            safe = path.lstrip("/").replace("\\", "/")
            if ".." in safe.split("/"):
                continue
            zf.writestr(safe, content)
    buf.seek(0)

    safe_title = (node.title or "atelier-variant").replace('"', "").replace("/", "-")
    safe_title = "".join(c if c.isalnum() or c in "-_ " else "" for c in safe_title)[:80].strip() or "atelier-variant"
    filename = f"{safe_title}-react.zip"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
            # Surface the cost so the dialog can update its pill from the
            # response headers without parsing the binary body.
            "X-Atelier-React-Cost-Cents": str(result["cost_cents"]),
            "X-Atelier-React-Model": result["model_used"],
        },
    )


def _published_slug_for(node: Node) -> str:
    """Stable, URL-safe slug derived from the node id.

    Single-user assumption: collisions are ignored — first 8 chars of the
    UUID hex give us ~4B distinct slugs, more than enough for personal use.
    """
    raw = (node.id or "").replace("-", "").lower()
    return raw[:8] if raw else "unknown"


def _public_url_for_slug(slug: str) -> str:
    """Mint the public URL for a published slug.

    Uses the same env-driven sandbox host as `/variant/` so swapping
    `ATELIER_SANDBOX_PORT` (or the hosted public URL) flows through here.
    """
    # Prefer the hosted public URL if configured (Render deployments);
    # fall back to localhost:<sandbox_port> for dev.
    base = (settings.atelier_sandbox_public_url or settings.sandbox_base_url).rstrip("/")
    return f"{base}/p/{slug}/"


def _read_published_meta(node: Node) -> dict | None:
    """Pull the `published_slug` blob out of `node.reasoning`.

    We chose the `reasoning` JSON column over a new `published_slug` DB
    column to avoid a schema migration — `reasoning` is already a free-form
    JSON dict on every Node, and Publish-to-URL is a single-user feature
    where we don't need to query/index the slug. Returns None if the node
    has never been published.
    """
    r = node.reasoning or {}
    meta = r.get("published_slug") if isinstance(r, dict) else None
    if not isinstance(meta, dict):
        return None
    if not meta.get("slug"):
        return None
    return meta


@router.post("/{node_id}/publish")
async def publish_node(node_id: str, session: AsyncSession = Depends(get_session)):
    """Publish (or re-publish) a variant to a public-ish URL.

    Copies the variant's already-built tree into `assets/published/<slug>/`
    so the sandbox-server can serve it at `/p/<slug>/`. Overwrites if the
    slug already exists (re-publish flow).
    """
    import shutil

    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    if node.build_status != "ready":
        raise HTTPException(
            status_code=400,
            detail=f"Node build_status={node.build_status!r}; can't publish.",
        )
    try:
        node_dir = await _ensure_node_on_disk(node)
    except FileNotFoundError as e:
        raise HTTPException(status_code=500, detail=str(e))

    slug = _published_slug_for(node)
    published_root = settings.assets_path / "published" / slug
    # Wipe-then-copy so re-publish doesn't leave stale files behind from the
    # previous build (e.g. a hero image the user later removed).
    if published_root.exists():
        shutil.rmtree(published_root, ignore_errors=True)
    published_root.mkdir(parents=True, exist_ok=True)
    for src in node_dir.rglob("*"):
        if not src.is_file():
            continue
        rel = src.relative_to(node_dir)
        dst = published_root / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    # Mirror the tree to Supabase under `published/<slug>/...` so the hosted
    # sandbox-server (proxy mode) can serve it at `/p/<slug>/`. Local mode is
    # a no-op. Failures here MUST NOT roll back the local copy — a successful
    # publish in dev shouldn't fail because the operator hasn't configured
    # Supabase yet (or the upload is flaky). We log and move on; callers can
    # re-publish to retry the upload.
    import logging as _logging

    try:
        await storage.upload_published_tree(slug, published_root)
    except Exception as e:  # pragma: no cover — network-dependent
        _logging.getLogger(__name__).warning(
            "supabase publish upload failed for slug=%s: %s", slug, e
        )

    published_at = now_iso()
    public_url = _public_url_for_slug(slug)

    # Persist on the node so subsequent GETs can return it. We merge into
    # the existing reasoning dict rather than overwrite — fork/critic flows
    # may have stored their own keys.
    new_reasoning = dict(node.reasoning) if isinstance(node.reasoning, dict) else {}
    new_reasoning["published_slug"] = {
        "slug": slug,
        "public_url": public_url,
        "published_at": published_at,
    }
    node.reasoning = new_reasoning
    # SQLAlchemy doesn't notice in-place dict mutations on JSON columns by
    # default; reassigning above flags the attribute dirty. Belt-and-braces:
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(node, "reasoning")
    await session.commit()

    return {
        "slug": slug,
        "public_url": public_url,
        "published_at": published_at,
    }


@router.get("/{node_id}/publish")
async def get_published_state(node_id: str, session: AsyncSession = Depends(get_session)):
    """Return the current published metadata for a node, or 404 if never published."""
    node = await session.get(Node, node_id)
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    meta = _read_published_meta(node)
    if not meta:
        raise HTTPException(status_code=404, detail="Not published")
    # Refresh the public URL each call — if the operator changes
    # ATELIER_SANDBOX_PORT or sandbox_public_url between publish and read,
    # we want callers to see the *current* host.
    return {
        "slug": meta["slug"],
        "public_url": _public_url_for_slug(meta["slug"]),
        "published_at": meta.get("published_at"),
    }


@router.get("/{node_id}/ancestors")
async def get_ancestors(node_id: str, session: AsyncSession = Depends(get_session)):
    """Return the branch path from root to the given node."""
    chain: list[dict] = []
    current = await session.get(Node, node_id)
    if not current:
        raise HTTPException(status_code=404, detail="Node not found")
    while current:
        chain.insert(
            0,
            {
                "id": current.id,
                "title": current.title,
                "type": current.type,
                "parent_id": current.parent_id,
            },
        )
        if not current.parent_id:
            break
        current = await session.get(Node, current.parent_id)
    return {"chain": chain}
