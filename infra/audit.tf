resource "google_project_iam_audit_config" "secretmanager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
}

resource "google_project_iam_audit_config" "iamcredentials" {
  project = var.project_id
  # IAM Credentials Data Access logging is configured through the IAM API.
  service = "iam.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }
}

resource "google_project_iam_audit_config" "storage" {
  project = var.project_id
  service = "storage.googleapis.com"

  audit_log_config {
    log_type = "DATA_READ"
  }

  audit_log_config {
    log_type = "DATA_WRITE"
  }
}
