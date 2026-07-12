# 이미지는 CI(gcloud run deploy)가 갱신 — tofu는 서비스 구성만 소유
locals {
  placeholder_image = "us-docker.pkg.dev/cloudrun/container/hello"

  # ---- 서비스 env 결선 — 시크릿 값 주입은 gcloud(README), 여기는 참조만 ----
  # 주의: 시크릿에 버전이 없으면 리비전이 기동 실패한다 — 부트스트랩은 2단계 apply(README).
  api_plain_env = merge({
    ENV                              = "staging"
    GCS_UPLOAD_BUCKET                = google_storage_bucket.uploads.name
    GCS_ASSETS_BUCKET                = google_storage_bucket.assets.name
    GCP_PROJECT_ID                   = var.project_id
    GCP_REGION                       = var.region
    CLOUD_TASKS_QUEUE                = google_cloud_tasks_queue.finalize.name
    CLOUD_TASKS_OIDC_SERVICE_ACCOUNT = google_service_account.tasks.email
    WORKER_BASE_URL                  = google_cloud_run_v2_service.worker_generate.uri
    WORKER_OIDC_AUDIENCE             = google_cloud_run_v2_service.worker_generate.uri
    WORKER_FINALIZE_URL              = google_cloud_run_v2_service.worker_finalize.uri
    BATCH_OIDC_AUDIENCE              = local.batch_audience # scheduler.tf와 문자열 일치 필수
    BATCH_INVOKER_EMAIL              = google_service_account.scheduler.email
  }, var.api_extra_env)

  api_secret_env = {
    DATABASE_URL         = google_secret_manager_secret.database_url.secret_id
    JWT_SECRET           = google_secret_manager_secret.app["jwt-secret"].secret_id
    SESSION_SECRET       = google_secret_manager_secret.app["session-secret"].secret_id
    EDGE_PROXY_SECRET    = google_secret_manager_secret.app["edge-proxy-secret"].secret_id
    TOSS_SECRET_KEY      = google_secret_manager_secret.app["toss-secret-key"].secret_id
    SOLAPI_API_KEY       = google_secret_manager_secret.app["solapi-api-key"].secret_id
    SOLAPI_API_SECRET    = google_secret_manager_secret.app["solapi-api-secret"].secret_id
    GOOGLE_CLIENT_SECRET = google_secret_manager_secret.app["google-client-secret"].secret_id
    KAKAO_CLIENT_SECRET  = google_secret_manager_secret.app["kakao-client-secret"].secret_id
    SENTRY_DSN           = google_secret_manager_secret.app["sentry-dsn-api"].secret_id
  }

  worker_plain_env = merge({
    ENV        = "staging"
    GCS_BUCKET = google_storage_bucket.assets.name
  }, var.worker_extra_env)

  worker_secret_env = {
    DATABASE_URL = google_secret_manager_secret.database_url.secret_id
    SENTRY_DSN   = google_secret_manager_secret.app["sentry-dsn-worker"].secret_id
  }

  # 외부 API 키는 generate만 — finalize는 로컬 Pillow 연산뿐(최소 권한)
  worker_generate_secret_env = merge(local.worker_secret_env, {
    OPENAI_API_KEY  = google_secret_manager_secret.app["openai-api-key"].secret_id
    GEMINI_API_KEY  = google_secret_manager_secret.app["gemini-api-key"].secret_id
    RECRAFT_API_KEY = google_secret_manager_secret.app["recraft-api-key"].secret_id
  })
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
      dynamic "env" {
        for_each = local.api_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.api_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }
  depends_on = [google_project_service.apis]
}

# 스키마 적용 잡 — api 이미지 재사용(db/·alembic 포함), deploy.yml이 이미지 갱신 후 execute --wait.
# 실패한 실행의 자동 재시도 금지(max_retries=0) — CI가 중단하고 사람이 개입.
resource "google_cloud_run_v2_job" "migrate" {
  name     = "migrate"
  location = var.region

  template {
    template {
      service_account = google_service_account.api.email # cloudsql.client·secretAccessor 보유
      max_retries     = 0
      timeout         = "600s"

      containers {
        image   = local.placeholder_image
        command = ["alembic"]
        args    = ["-c", "db/alembic.ini", "upgrade", "head"]

        env {
          name = "DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = "latest"
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.main.connection_name]
        }
      }
    }
  }

  lifecycle {
    # 잡은 template가 이중 중첩 — 서비스 경로 복붙 금지
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
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
      dynamic "env" {
        for_each = local.worker_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.worker_generate_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
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
      dynamic "env" {
        for_each = local.worker_plain_env
        content {
          name  = env.key
          value = env.value
        }
      }
      dynamic "env" {
        for_each = local.worker_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = env.value
              version = "latest"
            }
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.main.connection_name]
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
