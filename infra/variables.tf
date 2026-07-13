variable "project_id" {
  description = "스테이징 전용 GCP 프로젝트 ID (프로덕션은 별도 프로젝트로 재사용 — ARCHITECTURE §8)"
  type        = string
}

variable "region" {
  type    = string
  default = "asia-northeast3" # 서울
}

variable "billing_account" {
  description = "예산 알림용 청구 계정 ID (XXXXXX-XXXXXX-XXXXXX)"
  type        = string
}

variable "alert_email" {
  description = "예산·uptime 알림 수신 이메일"
  type        = string
}

variable "budget_amount" {
  description = "월 예산(청구 계정 통화 단위 — KRW면 원)"
  type        = number
  default     = 100000
}

variable "github_repo" {
  type    = string
  default = "Bongseop-Kim/essesion"
}

variable "github_repository_id" {
  description = "GitHub OIDC trust에 사용하는 재사용 불가 numeric repository ID"
  type        = string
  default     = "1290445433"

  validation {
    condition     = can(regex("^[0-9]+$", var.github_repository_id))
    error_message = "github_repository_id must contain digits only."
  }
}

variable "api_min_instances" {
  description = "api 콜드스타트 제거는 프로덕션 요구(ARCHITECTURE §2) — 스테이징 기본 0으로 비용 절약"
  type        = number
  default     = 0
}

variable "db_tier" {
  description = "스테이징은 최소 사양, 프로덕션에서 상향"
  type        = string
  default     = "db-g1-small"
}

variable "app_secret_ids" {
  description = "기존 env에서 옮겨올 시크릿 컨테이너 — 값 주입은 gcloud로 (README)"
  type        = list(string)
  default = [
    "toss-secret-key",
    "solapi-api-key",
    "solapi-api-secret",
    "google-client-secret",
    "kakao-client-secret",
    "openai-api-key",
    "gemini-api-key",
    "recraft-api-key",
    "jwt-secret",
    "session-secret",
    "edge-proxy-secret",
    "sentry-dsn-api",
    "sentry-dsn-worker",
  ]
}

# 시크릿이 아닌 운영 설정(OAuth client id, 프론트 origin, Solapi 발신번호 등) —
# 도메인·계정 확정 후 tfvars에서 채운다. tofu가 env 소유권을 유지하기 위한 통로.
variable "api_extra_env" {
  description = "api 서비스 추가 env (비시크릿 — FRONTEND_ORIGIN, GOOGLE_CLIENT_ID 등)"
  type        = map(string)
  default     = {}
}

variable "worker_extra_env" {
  description = "worker 두 서비스 공통 추가 env (비시크릿)"
  type        = map(string)
  default     = {}
}

variable "upload_cors_origins" {
  description = "GCS 사용자 업로드를 허용할 store origin"
  type        = list(string)
  default = [
    "http://localhost:3000",
    "http://localhost:3001",
    "https://app.essesion.shop",
    "https://admin.essesion.shop",
  ]
}
