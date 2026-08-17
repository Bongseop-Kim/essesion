# GCP 고정비 절감: Cloud SQL 다운그레이드 + 컨테이너 스캔 비활성화

목표: 월 ~₩50k → ~₩20k (2026-08-17 비용 조사 기반). HA·백업·PITR·디스크는 건드리지 않는다.

## 1. Cloud SQL tier: db-g1-small → db-f1-micro

1. `infra/production.tfvars`에 추가:

   ```hcl
   db_tier = "db-f1-micro"
   ```

2. plan에서 **in-place update**인지 확인 — destroy/replace가 보이면 중단:

   ```bash
   tofu -chdir=infra plan -var-file=production.tfvars
   ```

3. tier 변경은 인스턴스 재시작 수반(수 분 다운타임) — 저트래픽 시간대에 apply:

   ```bash
   tofu -chdir=infra apply -var-file=production.tfvars
   ```

4. 검증:

   ```bash
   gcloud sql instances describe essesion-pg --project=ysindustry \
     --format="value(settings.tier,state)"        # db-f1-micro RUNNABLE
   curl -fsS https://api.essesion.shop/healthz    # api 정상
   ```

   apply 후 30분 내 uptime check 초록 확인.

## 2. 컨테이너 취약점 자동 스캔 비활성화 (푸시당 $0.26)

1. `infra/main.tf`의 `google_project_service.apis` 목록에서
   `"containerscanning.googleapis.com"` 줄 제거 후 apply.
2. `disable_on_destroy = false`라 API는 켜진 채 남으므로 직접 끈다:

   ```bash
   gcloud services disable containerscanning.googleapis.com --project=ysindustry
   ```

3. 검증 — 목록에 없어야 한다:

   ```bash
   gcloud services list --enabled --project=ysindustry | grep containerscanning
   ```

## 롤백

- tier: `db_tier`를 `db-g1-small`로 되돌려 apply (동일하게 재시작 수 분).
- 스캔: `main.tf` 목록 복원 후 apply (API 재활성화까지 tofu가 처리).
