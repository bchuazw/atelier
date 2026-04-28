"""Test fixtures for the Atelier API.

Each test gets its own in-memory SQLite + a fresh FastAPI app instance.
Real LLM/storage backends are never invoked — tests that exercise routes
which call out (fork, critics, media) should be added separately with
mocks or moved behind a marker. The suite here covers the cheap, fully
deterministic surface: project CRUD, workspace isolation, validation.
"""
from __future__ import annotations

import os
import tempfile

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session", autouse=True)
def _isolate_env():
    """Force a private SQLite + assets dir before any module imports config.

    Module-level state in `atelier_api.config` and `atelier_api.storage`
    captures the env at import time, so this MUST run before the first
    `from atelier_api...` import in any test module. autouse + session
    scope makes that ordering implicit.
    """
    tmp = tempfile.mkdtemp(prefix="atelier-test-")
    os.environ["ATELIER_DB_URL"] = "sqlite+aiosqlite:///:memory:"
    os.environ["ATELIER_ASSETS_DIR"] = tmp
    os.environ["ATELIER_STORAGE_MODE"] = "local"
    os.environ.setdefault("ANTHROPIC_API_KEY", "test-key-not-real")
    yield


@pytest_asyncio.fixture
async def client():
    """Fresh app + in-memory DB for each test.

    Using ASGITransport (not the live server) keeps tests in-process and
    avoids real network/port allocation. The lifespan starts the DB,
    which `init_db` populates from the SQLAlchemy metadata.
    """
    # Local imports so _isolate_env runs first.
    from atelier_api.db.session import engine
    from atelier_api.db.models import Base
    from atelier_api.main import app

    # Reset schema between tests so workspace_id leaks from prior tests
    # can't masquerade as fixture state.
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
