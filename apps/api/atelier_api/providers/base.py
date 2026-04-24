from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class LlmResponse:
    text: str
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_creation_tokens: int = 0

    @property
    def usage_dict(self) -> dict[str, int]:
        return {
            "input": self.input_tokens,
            "output": self.output_tokens,
            "cache_read": self.cache_read_tokens,
            "cache_creation": self.cache_creation_tokens,
        }


@dataclass
class MediaResponse:
    url: str
    model: str
    prompt: str
    kind: str
    local_path: Path | None = None
    cost_cents: int | None = None
    is_mock: bool = False
    usage: dict[str, Any] = field(default_factory=dict)

    @property
    def usage_dict(self) -> dict[str, Any]:
        return {
            "kind": self.kind,
            "model": self.model,
            "is_mock": self.is_mock,
            "cost_cents": self.cost_cents,
            **self.usage,
        }
