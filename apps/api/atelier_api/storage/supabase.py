"""Supabase Storage backend — uploads variant trees to a public bucket.

Why direct httpx instead of the supabase-py SDK: keeps deps minimal (httpx
is already in the project), and the surface we need is just two REST calls
(upload + public-url construction). Auth is the service-role key.

Bucket layout: <bucket>/<node_id>/<rel_path>     (bucket name is the namespace)
Public URL:    https://<project>.supabase.co/storage/v1/object/public/<bucket>/<node_id>/<rel_path>
"""
from __future__ import annotations

import logging
import mimetypes
from pathlib import Path

import httpx

from atelier_api.config import settings

log = logging.getLogger(__name__)


class SupabaseStorage:
    name = "supabase"

    def __init__(
        self,
        url: str | None = None,
        service_key: str | None = None,
        bucket: str | None = None,
        sandbox_public_url: str | None = None,
    ) -> None:
        self.url = (url or settings.supabase_url or "").rstrip("/")
        self.service_key = service_key or settings.supabase_service_key
        self.bucket = bucket or settings.supabase_bucket
        # When set, variant iframe URLs go through this proxy (which corrects
        # Content-Type). When empty we fall back to Supabase direct URLs —
        # HTML won't render correctly but other assets (images, CSS) will, so
        # this is only useful for sanity checks, not end-user iframes.
        self.sandbox_public_url = (
            sandbox_public_url
            or settings.atelier_sandbox_public_url
            or ""
        ).rstrip("/")
        if not self.url or not self.service_key or not self.bucket:
            raise RuntimeError(
                "SupabaseStorage requires SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_BUCKET. "
                f"Got url={bool(self.url)} key={bool(self.service_key)} bucket={self.bucket!r}"
            )

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        h = {
            "Authorization": f"Bearer {self.service_key}",
            "apikey": self.service_key,
            "x-upsert": "true",
        }
        if content_type:
            h["Content-Type"] = content_type
        return h

    def _object_path(self, variant_id: str, rel_path: str = "") -> str:
        rel = rel_path.lstrip("/").replace("\\", "/")
        if rel:
            return f"{variant_id}/{rel}"
        return variant_id

    async def upload_variant_tree(self, variant_id: str, src_dir: Path) -> None:
        if not src_dir.exists():
            raise FileNotFoundError(f"variant src_dir missing: {src_dir}")

        # Walk all files; upload sequentially. Variants are small (a few HTML +
        # one media asset), so concurrency isn't worth the complexity yet.
        files = [p for p in src_dir.rglob("*") if p.is_file()]
        log.info("[supabase-storage] uploading %d file(s) for variant %s", len(files), variant_id)

        async with httpx.AsyncClient(timeout=60.0) as client:
            for fp in files:
                rel = fp.relative_to(src_dir).as_posix()
                content_type, _ = mimetypes.guess_type(fp.name)
                content_type = content_type or "application/octet-stream"
                object_path = self._object_path(variant_id, rel)
                upload_url = f"{self.url}/storage/v1/object/{self.bucket}/{object_path}"
                data = fp.read_bytes()
                resp = await client.post(
                    upload_url,
                    headers=self._headers(content_type=content_type),
                    content=data,
                )
                if resp.status_code >= 400:
                    raise RuntimeError(
                        f"supabase upload failed [{resp.status_code}] {object_path}: {resp.text[:200]}"
                    )

    async def _list_objects(self, client: httpx.AsyncClient, prefix: str) -> list[dict]:
        """List objects under `prefix` (relative to bucket). Walks subdirectories."""
        list_url = f"{self.url}/storage/v1/object/list/{self.bucket}"
        collected: list[dict] = []
        stack = [prefix.rstrip("/")]
        while stack:
            p = stack.pop()
            resp = await client.post(
                list_url,
                headers={"Authorization": f"Bearer {self.service_key}", "apikey": self.service_key, "Content-Type": "application/json"},
                json={"prefix": p + "/", "limit": 500, "offset": 0},
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"supabase list failed [{resp.status_code}] {p}: {resp.text[:200]}")
            items = resp.json() or []
            for it in items:
                name = it.get("name") or ""
                full = f"{p}/{name}" if p else name
                # Folders have id=null in Supabase listings.
                if it.get("id") is None:
                    stack.append(full)
                else:
                    collected.append({"path": full, "size": (it.get("metadata") or {}).get("size")})
        return collected

    async def download_variant_tree(self, variant_id: str, dest_dir: Path) -> bool:
        """Download every file under variants/<id>/ into `dest_dir`.

        Idempotent: if `dest_dir/index.html` already exists we skip the fetch
        (the variant is already materialized locally for this process)."""
        index_local = dest_dir / "index.html"
        if index_local.exists():
            return False

        dest_dir.mkdir(parents=True, exist_ok=True)
        async with httpx.AsyncClient(timeout=60.0) as client:
            objects = await self._list_objects(client, variant_id)
            if not objects:
                log.warning("[supabase-storage] no objects to rehydrate for variant %s", variant_id)
                return False
            log.info(
                "[supabase-storage] rehydrating %d file(s) for variant %s into %s",
                len(objects),
                variant_id,
                dest_dir,
            )
            for obj in objects:
                # obj['path'] looks like "<variant_id>/path/to/file"; strip the prefix.
                rel = obj["path"]
                if rel.startswith(variant_id + "/"):
                    rel = rel[len(variant_id) + 1 :]
                public_url = f"{self.url}/storage/v1/object/public/{self.bucket}/{obj['path']}"
                resp = await client.get(public_url)
                resp.raise_for_status()
                target = dest_dir / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(resp.content)
        return True

    async def delete_variant_tree(self, variant_id: str) -> int:
        """Delete every object under variants/<id>/ from the bucket.

        Uses the bulk Supabase endpoint POST /storage/v1/object/<bucket> with
        body {"prefixes": [...]}; we pass the concrete object paths we
        enumerated. Returns count deleted."""
        async with httpx.AsyncClient(timeout=60.0) as client:
            objects = await self._list_objects(client, variant_id)
            if not objects:
                return 0
            # Supabase delete API expects {"prefixes": [exact/object/keys]} —
            # "prefixes" is a misnomer; passing a directory prefix alone
            # doesn't cascade. We always pass the full object paths.
            prefixes = [o["path"] for o in objects]
            resp = await client.request(
                "DELETE",
                f"{self.url}/storage/v1/object/{self.bucket}",
                headers={
                    "Authorization": f"Bearer {self.service_key}",
                    "apikey": self.service_key,
                    "Content-Type": "application/json",
                },
                json={"prefixes": prefixes},
            )
            if resp.status_code >= 400:
                raise RuntimeError(
                    f"supabase delete failed [{resp.status_code}]: {resp.text[:200]}"
                )
            log.info(
                "[supabase-storage] deleted %d object(s) for variant %s",
                len(prefixes),
                variant_id,
            )
            return len(prefixes)

    def variant_url(self, variant_id: str, rel_path: str = "") -> str:
        # Prefer the proxy when configured so HTML renders with correct MIME.
        if self.sandbox_public_url:
            rel = rel_path.lstrip("/").replace("\\", "/")
            base = f"{self.sandbox_public_url}/variant/{variant_id}/"
            return base + rel if rel else base
        # Fallback: direct Supabase URL. HTML will be served as text/plain —
        # use this only for non-HTML assets.
        object_path = self._object_path(variant_id, rel_path)
        base = f"{self.url}/storage/v1/object/public/{self.bucket}/{object_path}"
        if not rel_path:
            return base + "/index.html"
        return base
