from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from atelier_api.config import settings
from atelier_api.db.session import init_db
from atelier_api.keepwarm import start_keepwarm
from atelier_api.routes import fork, media, nodes, projects, settings_route

# Uvicorn only configures its own loggers; ensure our modules' INFO lines
# (keepwarm pings, storage rehydrate, SSE events) surface in Render logs.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Warm up asset directories.
    _ = settings.assets_path
    # Kick off keep-warm background task if ATELIER_KEEPWARM_URLS is set.
    warmer = start_keepwarm(app)
    try:
        yield
    finally:
        if warmer is not None:
            warmer.cancel()


app = FastAPI(title="Atelier API", version="0.1.0", lifespan=lifespan)

_allowed_origins = [
    f"http://localhost:{settings.atelier_web_port}",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
# Append hosted origins from env (e.g., https://atelier.onrender.com).
for raw in (settings.atelier_allowed_origins or "").split(","):
    origin = raw.strip().rstrip("/")
    if origin:
        _allowed_origins.append(origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router, prefix="/api/v1")
app.include_router(nodes.router, prefix="/api/v1")
app.include_router(fork.router, prefix="/api/v1")
app.include_router(media.router, prefix="/api/v1")
app.include_router(settings_route.router, prefix="/api/v1")


@app.get("/healthz")
async def healthz():
    return {"ok": True, "service": "atelier-api"}
