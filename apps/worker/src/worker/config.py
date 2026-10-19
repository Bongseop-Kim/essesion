from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
    gcs_bucket: str = ""
    # local/test에서 둘 다 비우면 builder가 localhost:4443/dev-assets를 사용한다.
    gcs_emulator_host: str = ""
    db_pool_size: int = Field(default=2, ge=1, le=20)
    # 동시 렌더 대비 여유.
    db_max_overflow: int = Field(default=2, ge=0, le=20)
    db_pool_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    engine_version: str = "0.1.0"
    preview_dpi: int = Field(default=192, ge=1, le=1200)
    max_tile_mm: float = Field(default=2000.0, gt=0.0, allow_inf_nan=False)
    max_svg_bytes: int = Field(default=2_000_000, ge=1)
    max_placement_instances: int = Field(default=50_000, ge=1)
    stripe_max_band_coverage: float = Field(default=0.75, ge=0.1, le=1.0)

    motif_max_aspect_ratio: float = Field(default=20.0, gt=1.0, allow_inf_nan=False)
    motif_edge_seam_tol: float = Field(default=2.0, gt=0.0, allow_inf_nan=False)
    motif_render_check: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
