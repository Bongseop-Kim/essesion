data "google_project" "this" {}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "cloudtasks.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudscheduler.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "docker" {
  repository_id = "essesion"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.apis]
}

# 생성물 버킷 — 공개 + content-hash 키 (ARCHITECTURE §2). 서빙은 Cloudflare 프록시 캐시 경유. worker 전용.
resource "google_storage_bucket" "assets" {
  name                        = "${var.project_id}-assets"
  location                    = var.region
  uniform_bucket_level_access = true
}

resource "google_storage_bucket_iam_member" "assets_public_read" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# 사용자 업로드 버킷 — 비공개, 서명 URL 전용 (ARCHITECTURE §6 "나머지는 서명 URL"). api 전용.
# 공개 grant 없음 — 고객 첨부(리폼·수선·견적 등)가 URL만으로 열리지 않도록 assets와 분리.
resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true

  cors {
    origin          = var.upload_cors_origins
    method          = ["GET", "HEAD", "PUT"]
    response_header = ["Content-Type", "ETag", "x-goog-content-length-range"]
    max_age_seconds = 3600
  }
}

# finalize 잡 큐 — 작업 단위 재시도 제어 (ARCHITECTURE §2)
resource "google_cloud_tasks_queue" "finalize" {
  name     = "finalize"
  location = var.region

  rate_limits {
    max_concurrent_dispatches = 2 # finalize 동시성 1~2 (§7)
  }

  retry_config {
    max_attempts = 5
  }

  depends_on = [google_project_service.apis]
}
