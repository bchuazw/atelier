"""Storage selection. Imported once at startup; backend is fixed for the process."""
from __future__ import annotations

import logging

from atelier_api.config import settings

from .base import StorageBackend
from .local import LocalStorage

log = logging.getLogger(__name__)


def _make_backend() -> StorageBackend:
    mode = (settings.atelier_storage_mode or "local").lower()
    if mode == "supabase":
        from .supabase import SupabaseStorage

        log.info("[storage] mode=supabase bucket=%s", settings.supabase_bucket)
        return SupabaseStorage()
    log.info("[storage] mode=local (sandbox-server at %s)", settings.sandbox_base_url)
    return LocalStorage()


storage: StorageBackend = _make_backend()


__all__ = ["storage", "StorageBackend"]
