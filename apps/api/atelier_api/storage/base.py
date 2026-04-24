"""Storage backend protocol.

Two implementations:

- LocalStorage (dev): variants live on disk under `assets/variants/<id>/`; the
  sandbox-server (Node, :4100) serves them. URL = http://localhost:4100/variant/<id>/
- SupabaseStorage (hosted): after the mutator writes a variant locally, every
  file is uploaded to a Supabase Storage public bucket. URL = the public
  Supabase Storage object URL. The sandbox-server is not deployed in this mode.

The backend is selected at startup by `settings.atelier_storage_mode`.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol


class StorageBackend(Protocol):
    """Adapter that decides where a variant lives and how to reach it."""

    name: str

    async def upload_variant_tree(self, variant_id: str, src_dir: Path) -> None:
        """Make the variant available at the URL returned by `variant_url`.

        For local storage this is a no-op (the sandbox-server reads from disk).
        For hosted storage this walks src_dir and uploads each file.
        """
        ...

    def variant_url(self, variant_id: str, rel_path: str = "") -> str:
        """Return the public URL where the variant's files can be fetched.

        `rel_path` is appended to the variant root (e.g. "media/hero.png").
        Empty rel_path yields the base URL (which serves index.html).
        """
        ...
