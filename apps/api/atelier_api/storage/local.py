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

    async def delete_variant_tree(self, variant_id: str) -> int:
        import shutil

        root = settings.assets_path / "variants" / variant_id
        if not root.exists():
            return 0
        n = sum(1 for _ in root.rglob("*") if _.is_file())
        shutil.rmtree(root, ignore_errors=True)
        return n

    async def upload_published_tree(self, slug: str, src_dir: Path) -> None:
        # `routes/nodes.py::publish_node` already wrote the tree to
        # `assets/published/<slug>/`, which is what the sandbox-server reads
        # from in local mode. Nothing to upload.
        return None

    async def delete_published_tree(self, slug: str) -> int:
        # The on-disk cleanup happens directly in `routes/nodes.py::delete_node`
        # (via `shutil.rmtree(assets/published/<slug>)`). This method exists so
        # callers can stay backend-agnostic, but in local mode it's a no-op.
        return 0
