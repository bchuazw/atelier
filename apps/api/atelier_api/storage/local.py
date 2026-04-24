from __future__ import annotations

from pathlib import Path

from atelier_api.config import settings


class LocalStorage:
    name = "local"

    async def upload_variant_tree(self, variant_id: str, src_dir: Path) -> None:
        # Files are already on disk where the sandbox-server reads them.
        return None

    def variant_url(self, variant_id: str, rel_path: str = "") -> str:
        base = f"{settings.sandbox_base_url}/variant/{variant_id}/"
        if not rel_path:
            return base
        return base + rel_path.lstrip("/")

    async def download_variant_tree(self, variant_id: str, dest_dir: Path) -> bool:
        # Local storage IS the source of truth; nothing to fetch.
        return False
