resource "google_service_account" "api" {
  account_id   = "run-api"
  display_name = "Cloud Run api"
}

resource "google_service_account" "worker_generate" {
  account_id   = "run-worker-generate"
  display_name = "Cloud Run worker-generate"
}

resource "google_service_account" "worker_finalize" {
  account_id   = "run-worker-finalize"
  display_name = "Cloud Run worker-finalize"
}

resource "google_service_account" "tasks" {
  account_id   = "tasks-invoker"
  display_name = "Cloud Tasks -> worker-finalize OIDC"
}

# 롤 0건 — api가 공개(allUsers invoker)라 invoker 불요, 검증은 api 앱 레벨(email 클레임 고정).
# tasks SA 재사용 금지: 배치 경로와 finalize 사칭 가능성을 분리.
resource "google_service_account" "scheduler" {
  account_id   = "scheduler-invoker"
  display_name = "Cloud Scheduler -> api /batch OIDC"
}

resource "google_service_account" "deployer" {
  account_id   = "github-deployer"
  display_name = "GitHub Actions deployer (WIF)"
}

resource "google_project_iam_member" "api_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/cloudtasks.enqueuer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_cloudsql" {
  for_each = {
    generate = google_service_account.worker_generate.email
    finalize = google_service_account.worker_finalize.email
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${each.value}"
}

resource "google_project_iam_member" "worker_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.worker_generate.email}"
}

# Secret Manager 접근은 프로젝트 전체가 아니라 실제 컨테이너가 참조하는 secret 단위로 제한한다.
resource "google_secret_manager_secret_iam_member" "database_url" {
  for_each = {
    api      = google_service_account.api.email
    generate = google_service_account.worker_generate.email
    finalize = google_service_account.worker_finalize.email
  }
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${each.value}"
}

resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each = toset([
    "jwt-secret",
    "session-secret",
    "edge-proxy-secret",
    "toss-secret-key",
    "solapi-api-key",
    "solapi-api-secret",
    "google-client-secret",
    "kakao-client-secret",
    "sentry-dsn-api",
  ])
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_generate_secrets" {
  for_each = toset([
    "sentry-dsn-worker",
    "recraft-api-key",
  ])
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_generate.email}"
}

resource "google_secret_manager_secret_iam_member" "worker_finalize_secrets" {
  for_each  = toset(["sentry-dsn-worker"])
  project   = var.project_id
  secret_id = google_secret_manager_secret.app[each.value].secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.worker_finalize.email}"
}

# 공개 생성물은 content-addressed 키에 생성 전용 precondition으로 쓴다.
# worker는 덮어쓰기·삭제·목록 조회가 불필요하므로 objectCreator만 부여한다.
resource "google_storage_bucket_iam_member" "assets_worker_rw" {
  for_each = {
    generate = google_service_account.worker_generate.email
    finalize = google_service_account.worker_finalize.email
  }
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${each.value}"
}

# 관리자 상품 이미지는 api가 공개 assets 버킷에 서명 업로드·정리한다.
resource "google_storage_bucket_iam_member" "assets_api_rw" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# 비공개 업로드는 api만 쓴다(서명 URL 발급·정리 배치 삭제).
resource "google_storage_bucket_iam_member" "uploads_rw" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.api.email}"
}

# v4 서명 URL은 키 파일 없는 Cloud Run에서 IAM signBlob으로 SA가 자기 자신을 서명한다.
resource "google_service_account_iam_member" "api_sign" {
  service_account_id = google_service_account.api.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${google_service_account.api.email}"
}

# api가 tasks SA의 OIDC 토큰으로 잡을 등록할 수 있게 actAs 부여
resource "google_service_account_iam_member" "api_actas_tasks" {
  service_account_id = google_service_account.tasks.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "deployer_roles" {
  for_each = toset([
    "roles/artifactregistry.writer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# CI는 OpenTofu가 미리 만든 세 서비스의 이미지만 갱신한다. 프로젝트 전체
# run.admin 대신 각 서비스에 developer를 부여해 다른 Cloud Run 리소스를 격리한다.
resource "google_cloud_run_v2_service_iam_member" "deployer_developer" {
  for_each = {
    api             = google_cloud_run_v2_service.api.name
    worker_generate = google_cloud_run_v2_service.worker_generate.name
    worker_finalize = google_cloud_run_v2_service.worker_finalize.name
  }
  name     = each.value
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# migrate 이미지를 갱신하고 실행하는 두 동작만 해당 job 리소스에 허용한다.
resource "google_cloud_run_v2_job_iam_member" "deployer_migrate_developer" {
  name     = google_cloud_run_v2_job.migrate.name
  location = var.region
  role     = "roles/run.developer"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_cloud_run_v2_job_iam_member" "deployer_migrate_invoker" {
  name     = google_cloud_run_v2_job.migrate.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.deployer.email}"
}

# 배포 시 런타임 SA를 서비스에 붙이기 위한 actAs
resource "google_service_account_iam_member" "deployer_actas" {
  for_each = {
    api             = google_service_account.api.name
    worker_generate = google_service_account.worker_generate.name
    worker_finalize = google_service_account.worker_finalize.name
  }
  service_account_id = each.value
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}

# ---- Workload Identity Federation: GitHub Actions → deployer (키 파일 없음) ----

resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"

  attribute_mapping = {
    "google.subject"          = "assertion.sub"
    "attribute.repository_id" = "assertion.repository_id"
  }
  # PR이 workflow 파일을 바꿔 id-token 권한을 다시 선언해도 GCP 쪽에서 거부한다.
  # 이름은 rename 오설정을 잡는 보조선이고, 재사용되지 않는 numeric ID가 정본이다.
  attribute_condition = <<-EOT
    assertion.repository_id == "${var.github_repository_id}" &&
    assertion.repository == "${var.github_repo}" &&
    assertion.ref == "refs/heads/main" &&
    assertion.workflow_ref == "${var.github_repo}/.github/workflows/deploy.yml@refs/heads/main" &&
    assertion.event_name == "workflow_run"
  EOT

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.deployer.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository_id/${var.github_repository_id}"
}
