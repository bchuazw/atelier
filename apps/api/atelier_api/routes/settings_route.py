from __future__ import annotations

import os

from fastapi import APIRouter
from pydantic import BaseModel

from atelier_api.config import settings
from atelier_api.llm.client import MODELS

router = APIRouter(prefix="/settings", tags=["settings"])


class ApiKeyIn(BaseModel):
    api_key: str


@router.post("/api-key")
async def set_api_key(body: ApiKeyIn):
    """Set the runtime Anthropic key. Stored only in-process for the session."""
    os.environ["ANTHROPIC_API_KEY"] = body.api_key
    return {"ok": True, "has_key": bool(body.api_key)}


@router.get("/status")
async def get_status():
    has_env = bool(os.environ.get("ANTHROPIC_API_KEY") or settings.anthropic_api_key)
    return {
        "has_api_key": has_env,
        "sandbox_url": settings.sandbox_base_url,
        "models_available": MODELS,
    }
