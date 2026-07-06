terraform {
  required_version = ">= 1.8"

  # 상태 버킷은 부트스트랩에서 수동 생성 — README 참조
  backend "gcs" {}

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 6.30, < 8"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "google" {
  project               = var.project_id
  region                = var.region
  billing_project       = var.project_id
  user_project_override = true # billing budget API에 필요
}
