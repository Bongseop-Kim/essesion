"""전 필드 default — 시크릿 없이 import 가능해야 한다(OpenAPI export·로컬 dry-run 전제).

시크릿 실값은 로컬 .env / 스테이징 Secret Manager. 시크릿 커밋 금지.
"""

from functools import lru_cache
from typing import Self
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = "local"
    database_url: str = "postgresql+asyncpg://essesion:essesion@localhost:5432/essesion"
    db_pool_size: int = Field(default=5, ge=1, le=20)
    db_max_overflow: int = Field(default=0, ge=0, le=20)
    db_pool_timeout_seconds: float = Field(default=10.0, gt=0, le=60)

    # 프론트 (콜백 리다이렉트·CORS)
    frontend_origin: str = "http://localhost:3000"
    admin_frontend_origin: str = "http://localhost:3001"
    cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3001"]
    # OAuth provider에 등록한 Cloudflare 공개 API origin. run.app 직통 주소 금지.
    public_api_origin: str = ""

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

    # 소셜 OAuth — Google·Kakao·Naver·Apple
    google_client_id: str = ""
    google_client_secret: str = ""
    kakao_client_id: str = ""
    kakao_client_secret: str = ""
    naver_client_id: str = ""
    naver_client_secret: str = ""
    apple_client_id: str = ""  # Services ID (웹 로그인용, 예: shop.essesion.signin)
    apple_team_id: str = ""
    apple_key_id: str = ""
    apple_private_key: str = ""  # Sign in with Apple .p8 PEM — 개행은 \n 이스케이프 허용

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
    # 로컬 GCS 에뮬레이터(docker compose의 fake-gcs-server) origin — local/test 전용.
    # 설정하면 RealGcsClient가 서명 없이 이 호스트로 업로드·서빙 URL을 발급한다.
    gcs_emulator_host: str = ""
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

    @model_validator(mode="after")
    def validate_public_api_origin(self) -> Self:
        if self.env in ("local", "test"):
            return self

        origin = self.public_api_origin.removesuffix("/")
        try:
            parsed = urlsplit(origin)
            _ = parsed.port  # 잘못된 port 표현도 설정 시점에 거부한다.
        except ValueError as exc:
            raise ValueError("PUBLIC_API_ORIGIN must be a valid public HTTPS origin") from exc

        hostname = parsed.hostname or ""
        if (
            parsed.scheme != "https"
            or not hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path
            or parsed.query
            or parsed.fragment
            or "?" in origin
            or "#" in origin
            or hostname in ("localhost", "127.0.0.1", "::1")
            or hostname.endswith(".localhost")
            or hostname.endswith(".run.app")
        ):
            raise ValueError("PUBLIC_API_ORIGIN must be a public HTTPS origin, not a run.app URL")

        self.public_api_origin = origin
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
