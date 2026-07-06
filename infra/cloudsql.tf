resource "google_sql_database_instance" "main" {
  name             = "essesion-pg"
  database_version = "POSTGRES_17"
  region           = var.region

  settings {
    edition = "ENTERPRISE"
    tier    = var.db_tier

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true # 생성 시점부터 PITR (ARCHITECTURE §6)
    }

    ip_configuration {
      ipv4_enabled = true # 접속은 cloud-sql-connector(IAM) 경유 — VPC 불요
    }
  }

  deletion_protection = true
  depends_on          = [google_project_service.apis]
}

resource "google_sql_database" "app" {
  name     = "essesion"
  instance = google_sql_database_instance.main.name
}

resource "random_password" "db" {
  length  = 32
  special = false
}

resource "google_sql_user" "app" {
  name     = "app"
  instance = google_sql_database_instance.main.name
  password = random_password.db.result
}
