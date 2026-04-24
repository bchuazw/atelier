"""Backward-compat shim. The real implementation lives in
`atelier_api.providers.claude`. New code should import from there directly.
"""
from atelier_api.providers.base import LlmResponse
from atelier_api.providers.claude import (
    DEFAULT_MODEL,
    MODELS,
    _get_client,
    _resolve_model,
    call,
)

__all__ = [
    "LlmResponse",
    "MODELS",
    "DEFAULT_MODEL",
    "call",
    "_get_client",
    "_resolve_model",
]
