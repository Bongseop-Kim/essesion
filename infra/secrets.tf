# 시크릿 컨테이너만 tofu 소유 — 값 주입은 gcloud (README). 시크릿 커밋 금지.
resource "google_secret_manager_secret" "app" {
  for_each  = toset(var.app_secret_ids)
  secret_id = each.value

  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

# DB 비밀번호는 tofu가 생성했으므로 버전까지 관리
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"

  replication {
    auto {}
  }
  depends_on = [google_project_service.apis]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db.result
}
