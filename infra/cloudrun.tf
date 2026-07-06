# 이미지는 CI(gcloud run deploy)가 갱신 — tofu는 서비스 구성만 소유
locals {
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"
}

resource "google_cloud_run_v2_service" "api" {
  name     = "api"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL" # 공개 — Cloudflare 프록시 경유 (ARCHITECTURE §2)

  template {
    service_account = google_service_account.api.email

    scaling {
      min_instance_count = var.api_min_instances
      max_instance_count = 10
    }

    containers {
      image = local.placeholder_image
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.apis]
}

# 외부-API-바운드 — 가볍고 동시성 높게, api의 동기 OIDC 호출만 수신 (§7)
resource "google_cloud_run_v2_service" "worker_generate" {
  name     = "worker-generate"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL" # 비공개는 IAM(invoker)으로 강제

  template {
    service_account = google_service_account.worker.email
    timeout         = "300s" # Recraft 120s 재시도 감안

    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }

    containers {
      image = local.placeholder_image
      resources {
        limits = { cpu = "1", memory = "1Gi" }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.apis]
}

# CPU·메모리-바운드 — Cloud Tasks 푸시만 수신, 동시성 1~2, dpi 상한 600 (§7)
resource "google_cloud_run_v2_service" "worker_finalize" {
  name     = "worker-finalize"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.worker.email
    timeout                          = "900s"
    max_instance_request_concurrency = 2

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }

    containers {
      image = local.placeholder_image
      resources {
        limits = { cpu = "2", memory = "4Gi" }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "api_public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "generate_invoker_api" {
  name     = google_cloud_run_v2_service.worker_generate.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.api.email}"
}

resource "google_cloud_run_v2_service_iam_member" "finalize_invoker_tasks" {
  name     = google_cloud_run_v2_service.worker_finalize.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.tasks.email}"
}
