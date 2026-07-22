# Cloud Scheduler → api /batch/* — 정리 배치 4종 (ARCHITECTURE §8.4, domains.md 배치)
# api가 공개 서비스라 Cloud Run IAM으로 못 막는다 — api 앱이 OIDC id-token의
# audience + email 클레임(scheduler SA)을 직접 검증한다 (api deps.verify_batch_token).

locals {
  # api 서비스 env(BATCH_OIDC_AUDIENCE)와 문자열이 정확히 일치해야 한다.
  # google_cloud_run_v2_service.api.uri를 api env에서 참조하면 자기참조 순환이라
  # 결정적 URL(https://<service>-<project#>.<region>.run.app)로 고정.
  # apply 후 `tofu output api_url`과 일치하는지 대조할 것 (README).
  batch_audience = "https://api-${data.google_project.this.number}.${var.region}.run.app"

  batch_jobs = {
    auto-confirm-orders             = "10 4 * * *"   # 일 1회 — 배송완료 7일 경과 자동 구매확정
    cancel-stale-orders             = "*/15 * * * *" # 대기중 30분 SLA — 최악 45분 내 정리
    reconcile-stale-generation-jobs = "*/15 * * * *" # Tasks 1h 재시도 종료 후 job·예산 회수
    cleanup-images                  = "40 4 * * *"   # 일 1회 — 만료·클레임 이미지 2단계 삭제(LIMIT 100)
    authoring-promotion-candidates  = "0 5 * * *"    # 일 1회 — 승인 검토용 RAG 예시 후보 선별
  }
}

resource "google_cloud_scheduler_job" "batch" {
  for_each  = local.batch_jobs
  name      = "batch-${each.key}"
  region    = var.region
  schedule  = each.value
  time_zone = "Asia/Seoul" # 배치의 "하루"는 KST

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.api.uri}/batch/${each.key}"

    oidc_token {
      service_account_email = google_service_account.scheduler.email
      audience              = local.batch_audience
    }
  }

  retry_config {
    retry_count = 1 # 엔드포인트가 멱등(skip_locked)이라 안전
  }

  depends_on = [google_project_service.apis]
}
