"""Application configuration via Pydantic Settings."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Central configuration - reads from .env or environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Database
    DATABASE_URL: str = (
        "postgresql+asyncpg://postgres:password@localhost:5432/spoticheck"
    )
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: float = 30.0

    # Storage retention (Spotify crawl payloads)
    RAW_RESPONSE_KEEP_PER_ITEM: int = 3
    RAW_RESPONSE_RETENTION_DAYS: int = 30
    CRAWL_JOB_RETENTION_DAYS: int = 90

    # Optional Spotify API app credentials (client-credentials flow)
    SPOTIFY_CLIENT_ID: str = ""
    SPOTIFY_CLIENT_SECRET: str = ""
    SPOTIFY_CLIENT_TOKEN: str = ""
    SPOTIFY_HTTP_TIMEOUT_SECONDS: float = 8.0

    # Spotify auth (legacy placeholders)
    SPOTIFY_EMAIL: str = ""
    SPOTIFY_PASSWORD: str = ""

    # Crawl Settings
    CRAWL_DELAY_SECONDS: float = 0.2
    MAX_RETRIES: int = 2
    CRAWL_TASK_MAX_CONCURRENCY: int = 8
    RATE_LIMIT_PER_MINUTE: int = 60
    PLAYLIST_PAGE_SIZE: int = 100
    PLAYLIST_MAX_TRACKS: int = 2000
    PLAYWRIGHT_ENABLE_FALLBACK: bool = False
    PLAYWRIGHT_INLINE_FALLBACK: bool = False
    PLAYWRIGHT_FAST_FAIL_ERRORS: bool = False
    # Keep this off by default: if True, track flow always re-checks visible playcount via Playwright.
    PLAYWRIGHT_COMPARE_VISIBLE_PLAYCOUNT: bool = False
    PLAYWRIGHT_TIMEOUT_MS: int = 45000
    PLAYWRIGHT_WAIT_MS: int = 2500
    PLAYWRIGHT_MAX_CONCURRENCY: int = 3
    PLAYWRIGHT_RETRIES: int = 1
    PLAYWRIGHT_HYDRATE_TIMEOUT_MS: int = 9000
    PLAYWRIGHT_ALBUM_MAX_TRACKS: int = 80

    # CORS
    FRONTEND_URL: str = "http://localhost:8080"
    SERVE_FRONTEND: bool = True
    FRONTEND_DIR: str = "../frontend"

    # App
    SECRET_KEY: str = "change-me-in-production"
    DEBUG: bool = False
    AUTO_INIT_DB: bool = True

    # JWT / Auth
    JWT_SECRET_KEY: str = "change-me-in-production-jwt"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRY_HOURS: int = 24
    # Refuse to start with placeholder secrets when DEBUG is false (escape hatch: set to false).
    # Default off: weak secrets only log a warning until the VPS .env is confirmed; set true to fail fast.
    ENFORCE_SECRET_CHECK: bool = False


_PLACEHOLDER_SECRETS = {"", "secret", "changeme", "change-me", "password"}


def _is_placeholder_secret(value: str | None) -> bool:
    normalized = (value or "").strip().lower()
    return normalized in _PLACEHOLDER_SECRETS or normalized.startswith(("change-me", "changeme", "change_me"))


def validate_production_secrets(config: "Settings") -> None:
    """Raise when a non-debug deployment still uses default/placeholder secrets."""
    if config.DEBUG:
        return
    weak = [
        name for name in ("JWT_SECRET_KEY", "SECRET_KEY")
        if _is_placeholder_secret(getattr(config, name, None))
    ]
    if weak and not config.ENFORCE_SECRET_CHECK:
        import logging
        logging.getLogger(__name__).warning(
            "SECURITY: %s still uses a default/placeholder value; set strong random values "
            "and ENFORCE_SECRET_CHECK=true.", ", ".join(weak))
        return
    if weak:
        raise RuntimeError(
            f"Refusing to start: {', '.join(weak)} still uses a default/placeholder value. "
            "Set strong random values in the environment (e.g. `openssl rand -hex 32`), "
            "or set DEBUG=true for local development."
        )


settings = Settings()
