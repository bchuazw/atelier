"""Provider abstraction. Claude for text/code/HTML; MiniMax for media;
Genspark for grounded web research (critics citations).

The legacy `atelier_api.llm` package is kept as a backward-compat shim that
re-exports from `providers.claude`. New code should import from
`atelier_api.providers.claude` (text), `atelier_api.providers.minimax`
(image + video), or `atelier_api.providers.genspark` (search + crawl).
"""
from . import claude, genspark, minimax
from .base import LlmResponse, MediaResponse

__all__ = ["claude", "genspark", "minimax", "LlmResponse", "MediaResponse"]
