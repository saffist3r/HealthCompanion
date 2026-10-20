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
    gemini_veo_model: str = "veo-3.1-fast-generate-preview"
    upload_dir: str = "uploads"
    max_upload_mb: int = 8
    cors_origins: str = "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173"
    daily_carb_target_g: float = 180.0
    high_meal_carb_g: float = 45.0
    very_high_meal_carb_g: float = 75.0

    jwt_secret: str = ""
    jwt_expire_minutes: int = 60 * 24 * 14  # 14 days
    # Signed /uploads URLs (meal photos) stay valid this long
    upload_url_ttl_minutes: int = 60 * 24 * 7
    # Failed logins allowed per email / client IP inside the window before 429
    login_max_failures: int = 10
    login_window_seconds: int = 15 * 60
    # "household": every user sees all devices' data. "owner": users see only devices they own.
    data_scope: str = "household"
    admin_email: str = ""
    admin_password: str = ""
    admin_name: str = "Admin"

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
    def jwt_secret_problem(self) -> str | None:
        """Why the JWT secret is unsafe to sign tokens with, or None when it is fine."""
        secret = (self.jwt_secret or "").strip()
        if not secret:
            return "JWT_SECRET is not set"
        if secret.lower().startswith("change-me") or secret == "CHANGE_ME_LONG_RANDOM":
            return "JWT_SECRET is still the placeholder value"
        if len(secret) < 32:
            return "JWT_SECRET must be at least 32 characters"
        return None

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def gemini_configured(self) -> bool:
        key = (self.gemini_api_key or "").strip()
        return bool(key) and not key.startswith("your-")

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
