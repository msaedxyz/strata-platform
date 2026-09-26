"""Runtime settings. All secrets come from environment variables."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="", extra="ignore")

    # Database. The application connects as strata_app. Migrations connect as the superuser.
    database_url: str = Field("postgresql://strata_app@localhost:5432/strata", alias="STRATA_DATABASE_URL")
    admin_database_url: str | None = Field(None, alias="STRATA_ADMIN_DATABASE_URL")
    app_db_password: str | None = Field(None, alias="STRATA_APP_DB_PASSWORD")
    owner_db_password: str | None = Field(None, alias="STRATA_OWNER_DB_PASSWORD")

    config_dir: Path = Field(REPO_ROOT / "config", alias="STRATA_CONFIG_DIR")
    prompts_dir: Path = Field(REPO_ROOT / "prompts", alias="STRATA_PROMPTS_DIR")

    # Object storage (S3 compatible).
    s3_endpoint_url: str | None = Field(None, alias="STRATA_S3_ENDPOINT_URL")
    s3_bucket: str = Field("strata-documents", alias="STRATA_S3_BUCKET")
    s3_access_key: str | None = Field(None, alias="STRATA_S3_ACCESS_KEY")
    s3_secret_key: str | None = Field(None, alias="STRATA_S3_SECRET_KEY")
    storage_dir: Path | None = Field(None, alias="STRATA_STORAGE_DIR")

    # Identity (OIDC).
    oidc_issuer: str = Field("http://localhost:8080/realms/strata", alias="STRATA_OIDC_ISSUER")
    oidc_internal_issuer: str | None = Field(None, alias="STRATA_OIDC_INTERNAL_ISSUER")
    oidc_audience: str = Field("strata-web", alias="STRATA_OIDC_AUDIENCE")
    oidc_jwks_url: str | None = Field(None, alias="STRATA_OIDC_JWKS_URL")
    oidc_client_id: str = Field("strata-web", alias="STRATA_OIDC_CLIENT_ID")

    # Personal data encryption. The master key wraps the key of each person.
    master_key: str | None = Field(None, alias="STRATA_MASTER_KEY")

    # Models.
    anthropic_api_key: str | None = Field(None, alias="ANTHROPIC_API_KEY")
    agent_backend: str = Field("auto", alias="STRATA_AGENT_BACKEND")

    # Collectors.
    contact_email: str = Field("strata-collector@example.invalid", alias="STRATA_CONTACT_EMAIL")
    fixture_mode: bool = Field(False, alias="STRATA_FIXTURE_MODE")
    verification_period_days: int = Field(30, alias="STRATA_VERIFICATION_PERIOD_DAYS")

    # Email alerts.
    smtp_host: str | None = Field(None, alias="STRATA_SMTP_HOST")
    smtp_port: int = Field(1025, alias="STRATA_SMTP_PORT")
    alert_email_to: str | None = Field(None, alias="STRATA_ALERT_EMAIL_TO")
    alert_email_from: str = Field("strata-alerts@example.invalid", alias="STRATA_ALERT_EMAIL_FROM")

    log_level: str = Field("INFO", alias="STRATA_LOG_LEVEL")


@lru_cache
def get_settings() -> Settings:
    return Settings()
