from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
    gcs_bucket: str = ""

    engine_version: str = "0.1.0"
    registry_version: str = "0.1.0"
    preview_dpi: int = Field(default=192, ge=1, le=1200)
    fabric_dpi: int = Field(default=300, ge=1, le=1200)
    max_dpi: int = Field(default=600, ge=1)
    max_tile_mm: float = Field(default=2000.0, gt=0.0, allow_inf_nan=False)
    max_svg_bytes: int = Field(default=2_000_000, ge=1)
    max_placement_instances: int = Field(default=50_000, ge=1)
    stripe_max_band_coverage: float = Field(default=0.75, ge=0.1, le=1.0)
    stripe_diagonal_repeats: int = Field(default=2, ge=2)

    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    recraft_api_key: str = ""
    recraft_model: str = "recraftv4_1_vector"
    recraft_style: str = ""
    recraft_size: str = "1024x1024"
    recraft_response_format: str = "url"
    recraft_base_url: str = "https://external.api.recraft.ai/v1"
    recraft_max_color_slots: int = Field(default=6, ge=1)

    motif_similarity_tau: float = Field(default=0.84, ge=0.0, le=1.0)
    motif_candidate_top_k: int = Field(default=5, ge=1)
    motif_max_aspect_ratio: float = Field(default=20.0, gt=1.0, allow_inf_nan=False)
    motif_edge_seam_tol: float = Field(default=2.0, gt=0.0, allow_inf_nan=False)
    motif_render_check: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
