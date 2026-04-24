from __future__ import annotations

import os
from typing import Any

from anthropic import AsyncAnthropic

from atelier_api.config import settings

from .base import LlmResponse

MODELS = {
    "opus": "claude-opus-4-7",
    "sonnet": "claude-sonnet-4-6",
    "haiku": "claude-haiku-4-5-20251001",
}

DEFAULT_MODEL = "sonnet"


def _resolve_model(choice: str | None) -> str:
    if not choice:
        choice = DEFAULT_MODEL
    return MODELS.get(choice, choice)


def _get_client(api_key: str | None = None) -> AsyncAnthropic:
    key = api_key or os.environ.get("ANTHROPIC_API_KEY") or settings.anthropic_api_key
    if not key:
        raise RuntimeError(
            "No Anthropic API key. Set ANTHROPIC_API_KEY in .env.local or POST to /api/v1/settings/api-key."
        )
    return AsyncAnthropic(api_key=key)


async def call(
    *,
    system: str | list[dict[str, Any]],
    user: str,
    model: str | None = None,
    max_tokens: int = 4096,
    api_key: str | None = None,
) -> LlmResponse:
    """Call Claude. `system` as a list enables prompt caching on static prefixes."""
    client = _get_client(api_key)
    resolved_model = _resolve_model(model)

    if isinstance(system, str):
        system_blocks: list[dict[str, Any]] = [{"type": "text", "text": system}]
    else:
        system_blocks = system

    resp = await client.messages.create(
        model=resolved_model,
        max_tokens=max_tokens,
        system=system_blocks,
        messages=[{"role": "user", "content": user}],
    )

    text = "".join(block.text for block in resp.content if getattr(block, "type", None) == "text")
    usage = resp.usage
    return LlmResponse(
        text=text,
        model=resolved_model,
        input_tokens=getattr(usage, "input_tokens", 0),
        output_tokens=getattr(usage, "output_tokens", 0),
        cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
        cache_creation_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
    )
