from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Health Companion API"
    database_url: str = "postgresql://healthcompanion:healthcompanion@localhost:5432/healthcompanion"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.6-flash"
    gemini_tts_model: str = "gemini-2.5-flash-preview-tts"
    gemini_tts_voice: str = "Charon"
    gemini_live_model: str = "gemini-2.5-flash-native-audio-preview-12-2025"
    gemini_veo_model: str = "veo-3.1-fast-generate-preview"
    # Self-hosted MedGemma (Ollama) for Understanding science briefs — e.g. http://100.x.x.x:11434
    medgemma_base_url: str = ""
    medgemma_model: str = "medgemma:4b"
    # Hard cap per Understanding request (CPU MedGemma is slow)
    medgemma_timeout_s: int = 90
    medgemma_max_checks: int = 4
    upload_dir: str = "uploads"
    max_upload_mb: int = 8
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    daily_carb_target_g: float = 180.0
    high_meal_carb_g: float = 45.0
    very_high_meal_carb_g: float = 75.0

    jwt_secret: str = "change-me-in-production"
    jwt_expire_minutes: int = 60 * 24 * 14  # 14 days
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = "Admin"
    # Read-only keys for /integrations/* as "name:sha256hex,..." (only hashes, never raw keys).
    integration_keys: str = ""
    # Swagger/ReDoc/OpenAPI schema; off in production (k8s sets API_DOCS_ENABLED=false).
    api_docs_enabled: bool = True

    # Daily report email (SMTP)
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_ssl: bool = True
    smtp_user: str = ""
    smtp_password: str = ""
    report_email_to: str = ""
    report_email_from: str = ""
    report_email_from_name: str = "Health Companion"
    # Public site URL used for share links / QR codes (override via PUBLIC_URL env)
    public_url: str = "http://localhost:5173"
    report_share_ttl_days: int = 30

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gemini_configured(self) -> bool:
        key = (self.gemini_api_key or "").strip()
        return bool(key) and not key.startswith("your-")

    @property
    def medgemma_configured(self) -> bool:
        return bool((self.medgemma_base_url or "").strip())

    @property
    def smtp_configured(self) -> bool:
        return bool(
            (self.smtp_host or "").strip()
            and (self.smtp_user or "").strip()
            and (self.smtp_password or "").strip()
            and (self.report_email_to or "").strip()
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
