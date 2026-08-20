# Cloud Scheduler → api /batch/* — 배치 4종 (ARCHITECTURE §7.4, domains.md 배치)
# api가 공개 서비스라 Cloud Run IAM으로 못 막는다 — api 앱이 OIDC id-token의
# audience + email 클레임(scheduler SA)을 직접 검증한다 (api deps.verify_batch_token).

locals {
  # scheduler가 발급하는 토큰의 audience이자 api 서비스 env(BATCH_OIDC_AUDIENCE) 값 —
  # 둘 다 이 local을 쓰므로 구성상 항상 일치한다. api는 자기 URL이 아니라 이 문자열로
  # 토큰을 검증하므로(deps.verify_batch_token) 실제 run.app URL과 같을 필요는 없다.
  # 값을 바꾸면 scheduler와 api 리비전이 함께 갱신되는 동안만 401이 난다.
  # (api env에서 google_cloud_run_v2_service.api.uri를 참조하면 자기참조 순환이라 불가.)
  batch_audience = "https://api-${data.google_project.this.number}.${var.region}.run.app"

  batch_jobs = {
    auto-confirm-orders            = "10 4 * * *"   # 일 1회 — 배송완료 7일 경과 자동 구매확정
    cancel-stale-orders            = "*/30 * * * *" # 대기중 30분 SLA — 최악 60분 내 정리 (호출 수 절반, perf-cost-reduction 리뷰 20번)
    cleanup-images                 = "40 4 * * *"   # 일 1회 — 만료·클레임 이미지 2단계 삭제(LIMIT 100)
    authoring-promotion-candidates = "0 5 * * *"    # 일 1회 — 승인 검토용 RAG 시범 후보 선별
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

# scheduler가 호출하는 주소는 api.uri, 토큰의 audience는 batch_audience로 서로 다르다 —
# 둘이 같은지 검사하지 않는다. api를 Cloud Run IAM(invoker)으로 잠그는 날에는 Google이
# audience=서비스 URL인 토큰을 요구하므로 그때 batch_audience를 api.uri에 맞춰야 한다.
# 지금은 api가 공개(allUsers)라 앱 검증(deps.verify_batch_token)만으로 충분하다.
