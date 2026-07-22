from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    service_mode: Literal["all", "generate", "finalize"] = "all"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
    gcs_bucket: str = ""
    # 로컬 GCS 에뮬레이터(docker compose의 fake-gcs-server) origin — local/test 전용.
    # api의 gcs_emulator_host와 같은 값이어야 api가 산출물 URL을 서빙할 수 있다.
    gcs_emulator_host: str = ""
    db_pool_size: int = Field(default=2, ge=1, le=20)
    db_max_overflow: int = Field(default=0, ge=0, le=20)
    db_pool_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    engine_version: str = "0.1.0"
    preview_dpi: int = Field(default=192, ge=1, le=1200)
    fabric_dpi: int = Field(default=300, ge=1, le=1200)
    max_dpi: int = Field(default=600, ge=1)
    max_tile_mm: float = Field(default=2000.0, gt=0.0, allow_inf_nan=False)
    max_svg_bytes: int = Field(default=2_000_000, ge=1)
    max_placement_instances: int = Field(default=50_000, ge=1)
    preview_render_concurrency: int = Field(default=2, ge=1, le=8)
    # Cloud Run finalize timeout is 900s. A lease must outlive one healthy request so a
    # retry cannot execute the same job concurrently; Cloud Tasks retries span this value.
    finalize_lease_seconds: int = Field(default=960, ge=1)
    stripe_max_band_coverage: float = Field(default=0.75, ge=0.1, le=1.0)
    stripe_diagonal_repeats: int = Field(default=2, ge=2)

    gcp_project_id: str = ""
    vertex_ai_location: str = "global"
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    authoring_pipeline_mode: Literal["legacy", "shadow", "canary", "v3"] = "legacy"
    authoring_shadow_percent: int = Field(default=5, ge=0, le=100)
    authoring_canary_percent: int = Field(default=10, ge=0, le=100)
    authoring_example_set_revision: str = Field(default="gallery-v1", min_length=1, max_length=64)
    embedding_model: str = "gemini-embedding-001"
    embedding_output_dimensionality: int = Field(default=3072, ge=1)
    recraft_api_key: str = ""
    recraft_model: str = "recraftv4_1_vector"
    recraft_style: str = ""
    recraft_size: str = "1024x1024"
    recraft_base_url: str = "https://external.api.recraft.ai/v1"
    recraft_max_color_slots: int = Field(default=6, ge=1)

    motif_similarity_tau: float = Field(default=0.84, ge=0.0, le=1.0)
    motif_max_aspect_ratio: float = Field(default=20.0, gt=1.0, allow_inf_nan=False)
    motif_edge_seam_tol: float = Field(default=2.0, gt=0.0, allow_inf_nan=False)
    motif_render_check: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
