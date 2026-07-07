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
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_temperature: float = 0.7
    openai_api_key: str = ""
    embedding_model: str = "text-embedding-3-small"
    recraft_api_key: str = ""
    recraft_model: str = "recraftv4_1_vector"
    recraft_style: str = ""
    recraft_size: str = "1024x1024"
    recraft_response_format: str = "url"
    recraft_base_url: str = "https://external.api.recraft.ai/v1"
    recraft_max_color_slots: int = 6

    motif_similarity_tau: float = 0.84
    motif_candidate_top_k: int = 5
    motif_max_aspect_ratio: float = 20.0
    motif_edge_seam_tol: float = 2.0
    motif_render_check: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
