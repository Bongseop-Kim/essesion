output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "worker_generate_url" {
  value = google_cloud_run_v2_service.worker_generate.uri
}

output "worker_finalize_url" {
  value = google_cloud_run_v2_service.worker_finalize.uri
}

output "db_connection_name" {
  description = "cloud-sql-python-connector용 인스턴스 연결 이름"
  value       = google_sql_database_instance.main.connection_name
}

output "artifact_repo" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.docker.repository_id}"
}

output "wif_provider" {
  description = "GitHub Actions vars.GCP_WIF_PROVIDER 값"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_sa" {
  description = "GitHub Actions vars.GCP_DEPLOYER_SA 값"
  value       = google_service_account.deployer.email
}
