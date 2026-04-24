from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from atelier_api.db.models import Node
from atelier_api.db.session import get_session
from atelier_api.storage import storage

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
