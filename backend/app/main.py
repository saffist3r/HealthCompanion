import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.core.bootstrap import init_db
from app.core.config import get_settings
from app.routers import (
    auth,
    care,
    glucose,
    health,
    integrations,
    live,
    meals,
    pump,
    reb3i_live,
    reports,
    uploads,
    users,
)

settings = get_settings()
logger = logging.getLogger(__name__)
Path(settings.upload_dir).resolve().mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    if not (settings.jwt_secret or "").strip():
        # An empty key would let anyone forge sessions and photo links.
        raise RuntimeError("JWT_SECRET is not set. Generate one with: openssl rand -hex 32")
    problem = settings.jwt_secret_problem
    if problem:
        logger.warning("%s — consider a stronger one (openssl rand -hex 32).", problem)
    init_db()
    yield


app = FastAPI(
    title=settings.app_name,
    version=__version__,
    lifespan=lifespan,
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url="/redoc" if settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

API_ROUTERS = [
    auth.router,
    users.router,
    meals.router,
    glucose.router,
    pump.router,
    health.router,
    reports.router,
    uploads.router,
    reb3i_live.router,
    integrations.router,
]

for router in API_ROUTERS:
    app.include_router(router, prefix="/api")
    # Legacy root paths for phone builds released before the /api prefix.
    app.include_router(router, include_in_schema=False)

# Web-only routes: no legacy root alias (/care/<token> and /live/<token> are frontend pages).
app.include_router(care.router, prefix="/api")
app.include_router(live.router, prefix="/api")


def health_check() -> dict:
    return {
        "ok": True,
        "service": "health-companion-api",
        "version": __version__,
        "aiProvider": "gemini",
        "geminiConfigured": settings.gemini_configured,
        "auth": "jwt",
    }


app.add_api_route("/api/health", health_check, methods=["GET"])
app.add_api_route("/health", health_check, methods=["GET"], include_in_schema=False)
