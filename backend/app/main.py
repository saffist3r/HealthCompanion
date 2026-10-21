from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.bootstrap import init_db
from app.core.config import get_settings
from app.routers import auth, glucose, health, integrations, meals, pump, reb3i_live, reports, users

settings = get_settings()
upload_path = Path(settings.upload_dir).resolve()
upload_path.mkdir(parents=True, exist_ok=True)

app = FastAPI(
    title=settings.app_name,
    version="0.3.0",
    docs_url="/docs" if settings.api_docs_enabled else None,
    redoc_url="/redoc" if settings.api_docs_enabled else None,
    openapi_url="/openapi.json" if settings.api_docs_enabled else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list + ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(upload_path)), name="uploads")

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(meals.router)
app.include_router(glucose.router)
app.include_router(pump.router)
app.include_router(health.router)
app.include_router(reports.router)
app.include_router(reb3i_live.router)
app.include_router(integrations.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/health")
def health_check() -> dict:
    return {
        "ok": True,
        "service": "health-companion-api",
        "aiProvider": "gemini",
        "geminiConfigured": settings.gemini_configured,
        "openaiConfigured": settings.gemini_configured,
        "auth": "jwt",
    }
