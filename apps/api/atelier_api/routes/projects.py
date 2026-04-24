from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.config import settings
from atelier_api.db.models import Edge, Node, Project
from atelier_api.db.session import get_session
from atelier_api.sandbox.fetcher import fetch_page
from atelier_api.storage import storage

router = APIRouter(prefix="/projects", tags=["projects"])


class CreateProjectIn(BaseModel):
    name: str
    seed_url: str | None = None


class ProjectOut(BaseModel):
    id: str
    name: str
    seed_url: str | None
    working_node_id: str | None
    created_at: str


class ProjectPatchIn(BaseModel):
    # Any field provided is updated; omitted fields are left alone.
    context: str | None = None
    active_checkpoint_id: str | None = None
    clear_checkpoint: bool | None = None


@router.post("", response_model=ProjectOut)
async def create_project(body: CreateProjectIn, session: AsyncSession = Depends(get_session)):
    project = Project(name=body.name, seed_url=body.seed_url)
    session.add(project)
    await session.flush()

    # Seed node (always create one; seed empty if no URL).
    seed = Node(
        project_id=project.id,
        type="seed",
        title="Seed",
        summary=f"Original: {body.seed_url}" if body.seed_url else "Blank seed",
        position_x=0.0,
        position_y=0.0,
        created_by="user",
    )
    session.add(seed)
    await session.flush()

    # If a URL was supplied, fetch and stash it under assets/variants/<node_id>/.
    if body.seed_url:
        variant_dir = settings.assets_path / "variants" / seed.id
        try:
            index_path = await fetch_page(body.seed_url, variant_dir)
            seed.artifact_path = str(variant_dir)
            seed.build_path = str(index_path.parent)
            await storage.upload_variant_tree(seed.id, variant_dir)
            seed.build_status = "ready"
        except Exception as e:
            seed.build_status = "error"
            seed.summary = f"Seed fetch failed: {e}"

    project.working_node_id = seed.id
    await session.commit()
    await session.refresh(project)

    return ProjectOut(
        id=project.id,
        name=project.name,
        seed_url=project.seed_url,
        working_node_id=project.working_node_id,
        created_at=project.created_at,
    )


@router.get("", response_model=list[ProjectOut])
async def list_projects(session: AsyncSession = Depends(get_session)):
    rows = (await session.execute(select(Project).order_by(Project.created_at.desc()))).scalars().all()
    return [
        ProjectOut(
            id=p.id, name=p.name, seed_url=p.seed_url, working_node_id=p.working_node_id, created_at=p.created_at
        )
        for p in rows
    ]


@router.get("/{project_id}/tree")
async def get_tree(
    project_id: str,
    include_archived: bool = False,
    session: AsyncSession = Depends(get_session),
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    all_nodes = (
        (await session.execute(select(Node).where(Node.project_id == project_id))).scalars().all()
    )

    proj_settings = project.settings or {}
    checkpoint_id = proj_settings.get("active_checkpoint_id")

    # When a checkpoint is active, the tree collapses to the subtree rooted at that
    # node. Older siblings/ancestors are "archived" (still in DB, hidden from default
    # tree loads for perf + focus). Callers can pass ?include_archived=true to see
    # everything regardless.
    total_count = len(all_nodes)
    filtered_by_checkpoint: list[Node] = all_nodes
    if checkpoint_id:
        by_id = {n.id: n for n in all_nodes}
        if checkpoint_id in by_id:
            children_of: dict[str, list[Node]] = {}
            for n in all_nodes:
                if n.parent_id:
                    children_of.setdefault(n.parent_id, []).append(n)
            visible: list[Node] = []
            stack = [checkpoint_id]
            seen: set[str] = set()
            while stack:
                nid = stack.pop()
                if nid in seen:
                    continue
                seen.add(nid)
                node = by_id.get(nid)
                if node is None:
                    continue
                visible.append(node)
                for child in children_of.get(nid, []):
                    stack.append(child.id)
            filtered_by_checkpoint = visible
        # If checkpoint node was deleted, silently fall back to showing everything.

    nodes = all_nodes if include_archived else filtered_by_checkpoint
    # archived_count reflects what would be hidden under the checkpoint — stable
    # across include_archived=true/false so the UI can always show "N archived".
    archived_count = total_count - len(filtered_by_checkpoint)

    node_ids = [n.id for n in nodes]
    visible_id_set = set(node_ids)
    edges: list[Edge] = []
    if node_ids:
        raw_edges = (
            (
                await session.execute(
                    select(Edge).where(Edge.from_node_id.in_(node_ids) | Edge.to_node_id.in_(node_ids))
                )
            )
            .scalars()
            .all()
        )
        # Only surface edges whose BOTH endpoints are visible (so archived parents don't dangle).
        edges = [e for e in raw_edges if e.from_node_id in visible_id_set and e.to_node_id in visible_id_set]

    return {
        "project": {
            "id": project.id,
            "name": project.name,
            "seed_url": project.seed_url,
            "working_node_id": project.working_node_id,
            "context": proj_settings.get("context", ""),
            "active_checkpoint_id": checkpoint_id,
            "archived_count": archived_count,
            "total_count": total_count,
        },
        "nodes": [
            {
                "id": n.id,
                "parent_id": n.parent_id,
                "type": n.type,
                "title": n.title,
                "summary": n.summary,
                "build_status": n.build_status,
                "model_used": n.model_used,
                "position": {"x": n.position_x, "y": n.position_y},
                "sandbox_url": storage.variant_url(n.id) if n.build_status == "ready" else None,
                "created_at": n.created_at,
                "is_checkpoint": bool(checkpoint_id) and n.id == checkpoint_id,
            }
            for n in nodes
        ],
        "edges": [
            {
                "id": e.id,
                "from": e.from_node_id,
                "to": e.to_node_id,
                "type": e.type,
                "prompt_text": e.prompt_text,
            }
            for e in edges
        ],
    }


@router.patch("/{project_id}")
async def patch_project(
    project_id: str,
    body: ProjectPatchIn,
    session: AsyncSession = Depends(get_session),
):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    # Rebuild settings dict (SQLAlchemy dirty-tracking on JSON columns needs a new object).
    current = dict(project.settings or {})
    if body.context is not None:
        current["context"] = body.context
    if body.clear_checkpoint:
        current.pop("active_checkpoint_id", None)
    elif body.active_checkpoint_id is not None:
        # Validate the node belongs to this project before pinning it.
        node = await session.get(Node, body.active_checkpoint_id)
        if not node or node.project_id != project_id:
            raise HTTPException(status_code=400, detail="Checkpoint node not in this project")
        current["active_checkpoint_id"] = body.active_checkpoint_id
    project.settings = current
    await session.commit()
    return {
        "ok": True,
        "context": current.get("context", ""),
        "active_checkpoint_id": current.get("active_checkpoint_id"),
    }


@router.delete("/{project_id}")
async def delete_project(project_id: str, session: AsyncSession = Depends(get_session)):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    await session.delete(project)
    await session.commit()
    return {"ok": True}
