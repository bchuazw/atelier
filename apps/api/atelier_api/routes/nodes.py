from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.db.models import Node
from atelier_api.db.session import get_session
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

    return {"ok": True, "deleted": len(to_delete), "storage_cleaned": cleaned, "storage_failed": failed}


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
