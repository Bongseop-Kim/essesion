data "google_project" "this" {}

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "monitoring.googleapis.com",
    "billingbudgets.googleapis.com",
    "cloudscheduler.googleapis.com",
    "aiplatform.googleapis.com",
  ])
  service            = each.value
  disable_on_destroy = false
}

resource "google_artifact_registry_repository" "docker" {
  repository_id = "essesion"
  format        = "DOCKER"
  location      = var.region
  depends_on    = [google_project_service.apis]

  # 배포마다 이미지가 무한 누적돼 저장 요금이 붙는다 — 패키지별 최근 5개만 유지.
  # 롤백은 최근 리비전으로만 하므로 5개면 충분. dry run 없이 바로 적용(회수 불가 삭제지만
  # 이미지는 재빌드 가능).
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent-5"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
  cleanup_policies {
    id     = "delete-stale"
    action = "DELETE"
    condition {
      older_than = "2592000s" # 30일
    }
  }
}

# 생성물 버킷 — 공개 + content-hash 키 (ARCHITECTURE §1). worker 전용.
# 서빙: api env PUBLIC_ASSETS_ORIGIN이 설정되면 Cloudflare assets-proxy 캐시 경유,
# 미설정이면 storage.googleapis.com 직통 (infra/cloudflare/README.md 개통 순서 참조).
resource "google_storage_bucket" "assets" {
  name                        = "${var.project_id}-assets"
  location                    = var.region
  uniform_bucket_level_access = true

  # 기본 소프트 삭제(7일)는 삭제된 객체에도 저장 요금을 물린다 — 생성물은
  # content-hash 키라 재생성 가능하므로 끈다. 복구가 필요해지면 604800(7일)으로 원복.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  cors {
    origin          = var.upload_cors_origins
    method          = ["GET", "HEAD", "PUT"]
    response_header = ["Content-Type", "ETag", "x-goog-content-length-range", "x-goog-if-generation-match"]
    max_age_seconds = 3600
  }
}

resource "google_storage_bucket_iam_member" "assets_public_read" {
  bucket = google_storage_bucket.assets.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# 사용자 업로드 버킷 — 비공개, 서명 URL 전용 (ARCHITECTURE §5 "나머지는 서명 URL"). api 전용.
# 공개 grant 없음 — 고객 첨부(리폼·수선·견적 등)가 URL만으로 열리지 않도록 assets와 분리.
resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  # 단명 스테이징 객체가 많아 소프트 삭제(7일)의 삭제분 저장 요금 비중이 크다 — 끈다.
  # 나이 기준 자동 삭제는 넣지 않는다: 만료·클레임 정리는 도메인 규칙을 아는
  # cleanup-images 배치(api batch/router.py)가 수행한다.
  soft_delete_policy {
    retention_duration_seconds = 0
  }

  cors {
    origin          = var.upload_cors_origins
    method          = ["GET", "HEAD", "PUT"]
    response_header = ["Content-Type", "ETag", "x-goog-content-length-range", "x-goog-if-generation-match"]
    max_age_seconds = 3600
  }
}

