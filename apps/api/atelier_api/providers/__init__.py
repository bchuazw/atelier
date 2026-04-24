"""Provider abstraction. Claude for text/code/HTML; MiniMax for media.

The legacy `atelier_api.llm` package is kept as a backward-compat shim that
re-exports from `providers.claude`. New code should import from
`atelier_api.providers.claude` (text) or `atelier_api.providers.minimax`
(image + video) directly.
"""
from . import claude, minimax
from .base import LlmResponse, MediaResponse

__all__ = ["claude", "minimax", "LlmResponse", "MediaResponse"]
