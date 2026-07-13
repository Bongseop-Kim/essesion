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
    admin_frontend_origin: str = "http://localhost:3001"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]

    # Auth
    jwt_secret: str = "dev-jwt-secret-only-for-local-32b!"  # HS256 최소 32바이트
    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 14
    admin_refresh_ttl_hours: int = 12
    admin_auth_rate_limit_attempts: int = 10
    admin_auth_rate_limit_window_seconds: int = 60
    admin_auth_rate_limit_max_keys: int = 10_000
    store_auth_rate_limit_attempts: int = 10
    store_auth_rate_limit_window_seconds: int = 60
    phone_verify_rate_limit_attempts: int = 20
    phone_verify_rate_limit_window_seconds: int = 60
    toss_webhook_rate_limit_attempts: int = 300
    toss_webhook_rate_limit_window_seconds: int = 60
    public_rate_limit_max_keys: int = 10_000
    toss_invalid_key_cache_ttl_seconds: int = 60
    # Cloudflare api-proxy가 덮어쓰는 전역 origin 검증용 공유값.
    # local/test는 우회하며 그 외 환경은 빈 값이면 readiness와 일반 요청이 fail closed.
    edge_proxy_secret: str = ""
    session_secret: str = "dev-session-secret"  # Authlib OAuth state 쿠키용

    # 소셜 OAuth — Google·Kakao만 (Apple·Naver는 준비물 도착 후)
    google_client_id: str = ""
    google_client_secret: str = ""
    kakao_client_id: str = ""
    kakao_client_secret: str = ""

    # 외부 연동 — 비어 있으면 local/test만 DryRun, 그 밖의 환경은 unavailable
    toss_secret_key: str = ""
    solapi_api_key: str = ""
    solapi_api_secret: str = ""
    solapi_sender_number: str = ""
    solapi_pf_id: str = ""
    solapi_template_claim_done: str = ""
    solapi_template_claim_rejected: str = ""
    solapi_template_quote_received: str = ""
    gcs_upload_bucket: str = ""  # 비공개 업로드 버킷 (공개 생성물 assets와 분리 — ARCHITECTURE §6)
    gcs_assets_bucket: str = ""  # 공개 상품·생성물 버킷
    gcs_assets_public_base_url: str = ""  # Cloudflare asset proxy 사용 시 override
    worker_base_url: str = "http://localhost:8001"
    worker_timeout_seconds: float = 180.0
    worker_finalize_inline: bool = False
    worker_oidc_audience: str = ""  # 비어 있으면 인증 없이 호출(로컬) — Cloud Run 프라이빗용
    worker_finalize_oidc_audience: str = ""
    design_finalize_budget: int = 10  # 세션당 finalize 상한 (worker-pipeline.md §5)
    design_recraft_budget: int = 3  # 세션당 Recraft 모티프 생성 상한 (worker-motifs.md §5)
    gcp_project_id: str = ""
    gcp_region: str = "asia-northeast3"
    cloud_tasks_queue: str = "finalize"
    cloud_tasks_oidc_service_account: str = ""
    worker_finalize_url: str = ""

    # Cloud Scheduler → /batch/* — audience 설정 시 Google OIDC 검증(+ 발신 SA email 고정),
    # 비어 있으면 batch_token 폴백(로컬·테스트). 값은 tofu가 주입 (infra/scheduler.tf)
    batch_oidc_audience: str = ""
    batch_invoker_email: str = ""
    batch_token: str = "dev-batch-token"


@lru_cache
def get_settings() -> Settings:
    return Settings()
