"""전 필드 default — 시크릿 없이 import 가능해야 한다(OpenAPI export·로컬 dry-run 전제).

시크릿 실값은 로컬 .env / 스테이징 Secret Manager. 시크릿 커밋 금지.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"

    # 프론트 (콜백 리다이렉트·CORS)
    frontend_origin: str = "http://localhost:3000"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # Auth
    jwt_secret: str = "dev-jwt-secret-only-for-local-32b!"  # HS256 최소 32바이트
    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 14
    session_secret: str = "dev-session-secret"  # Authlib OAuth state 쿠키용

    # 소셜 OAuth — Google·Kakao만 (Apple·Naver는 준비물 도착 후)
    google_client_id: str = ""
    google_client_secret: str = ""
    kakao_client_id: str = ""
    kakao_client_secret: str = ""

    # 외부 연동 — 비어 있으면 DryRun 클라이언트로 동작
    toss_secret_key: str = ""
    solapi_api_key: str = ""
    solapi_api_secret: str = ""
    solapi_sender_number: str = ""
    solapi_pf_id: str = ""
    solapi_template_claim_done: str = ""
    solapi_template_claim_rejected: str = ""
    solapi_template_quote_received: str = ""
    gcs_bucket: str = ""
    worker_base_url: str = "http://localhost:8001"
    worker_timeout_seconds: float = 180.0
    worker_finalize_inline: bool = False
    worker_oidc_audience: str = ""  # 비어 있으면 인증 없이 호출(로컬) — Cloud Run 프라이빗용
    design_finalize_budget: int = 10  # 세션당 finalize 상한 (worker-pipeline.md §5)
    gcp_project_id: str = ""
    gcp_region: str = "asia-northeast3"
    cloud_tasks_queue: str = "finalize"
    cloud_tasks_oidc_service_account: str = ""
    worker_finalize_url: str = ""

    # Cloud Scheduler → /batch/* (4단계에서 OIDC 검증으로 교체)
    batch_token: str = "dev-batch-token"


@lru_cache
def get_settings() -> Settings:
    return Settings()
