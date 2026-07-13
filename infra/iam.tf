resource "google_service_account" "api" {
  account_id   = "run-api"
  display_name = "Cloud Run api"
}

resource "google_service_account" "worker" {
  account_id   = "run-worker"
  display_name = "Cloud Run worker-generate/finalize"
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
    "roles/secretmanager.secretAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "worker_roles" {
  for_each = toset([
    "roles/cloudsql.client",
    "roles/secretmanager.secretAccessor",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.worker.email}"
}

# 공개 생성물 쓰기는 worker만 한다. api는 main.tf의 allUsers viewer 권한으로 읽고
# 주문 첨부 복사본은 비공개 uploads 버킷에만 쓴다.
resource "google_storage_bucket_iam_member" "assets_rw" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.worker.email}"
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
    "roles/run.admin",
    "roles/artifactregistry.writer",
  ])
  project = var.project_id
  role    = each.value
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

# 배포 시 런타임 SA를 서비스에 붙이기 위한 actAs
resource "google_service_account_iam_member" "deployer_actas" {
  for_each = {
    api    = google_service_account.api.name
    worker = google_service_account.worker.name
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
    (assertion.event_name == "workflow_run" || assertion.event_name == "workflow_dispatch")
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
