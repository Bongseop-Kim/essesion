from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
    gcs_bucket: str = ""

    engine_version: str = "0.1.0"
    registry_version: str = "0.1.0"
    preview_dpi: int = 192
    fabric_dpi: int = 300
    max_dpi: int = 600
    max_tile_mm: float = 2000.0
    max_svg_bytes: int = 2_000_000
    max_placement_instances: int = 50_000
    stripe_max_band_coverage: float = 0.75

    gemini_api_key: str = ""
    openai_api_key: str = ""
    recraft_api_key: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
