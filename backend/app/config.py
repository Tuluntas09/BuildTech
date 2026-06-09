from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    app_name: str = "BuildTech"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    log_level: str = "INFO"

    # CORS — Vite default dev server; override via CORS_ORIGINS env var
    cors_origins: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
    ]

    # Database — used from Task 3 onward; declared here so config is complete
    database_url: str = "sqlite:///./data/buildtech.db"

    # Frozen price snapshot parquet — written by scripts/build_price_snapshot.py (Task 6)
    snapshot_prices_path: str = "./snapshots/prices_snapshot.parquet"


@lru_cache
def get_settings() -> Settings:
    return Settings()
