# infra — OpenTofu (스테이징)

스테이징은 **별도 GCP 프로젝트로 격리** (ARCHITECTURE §8). 프로덕션은 7단계에서 같은 구성을 다른 project_id로 재사용.

## 부트스트랩 (1회, 수동)

```bash
# 1. 프로젝트 + 청구 연결
gcloud projects create essesion-staging
gcloud billing projects link essesion-staging --billing-account=XXXXXX-XXXXXX-XXXXXX

# 2. tofu 상태 버킷 (tofu 밖에서 생성 — 닭·달걀)
gcloud storage buckets create gs://essesion-staging-tfstate \
  --project=essesion-staging --location=asia-northeast3 --uniform-bucket-level-access

# 3. 변수 채우고 — apply는 2단계 (시크릿 버전이 없으면 서비스 리비전이 기동 실패하므로)
brew install opentofu
cp staging.tfvars.example staging.tfvars   # 값 채우기
tofu init -backend-config="bucket=essesion-staging-tfstate"

# 3-1. 시크릿 컨테이너·DB부터 — 서비스가 참조할 시크릿을 먼저 만들고 값을 주입
tofu apply -var-file=staging.tfvars \
  -target=google_secret_manager_secret.app \
  -target=google_secret_manager_secret_version.database_url \
  -target=google_sql_user.app
#    → 아래 "시크릿 값 주입" 수행 (전 시크릿에 버전 1개 이상)

# 3-2. 전체 apply
tofu apply -var-file=staging.tfvars
```

주의: `google_billing_budget`은 실행자에게 청구 계정 권한(Billing Account Administrator/Costs Manager)이 필요하다.

## 개통 체크리스트 (사용자 액션 ↔ 자동화 구분)

| # | 액션 | 주체 |
|---|---|---|
| 1 | GCP 프로젝트 생성·청구 연결·tfstate 버킷 (위 부트스트랩 1~2) | **사용자(gcloud)** |
| 2 | `staging.tfvars` 작성 (+도메인 확정 시 `api_extra_env`) | **사용자** |
| 3 | 3-1 target apply → 시크릿 값 주입 → 3-2 전체 apply | **사용자(로컬 tofu)** |
| 4 | Sentry 프로젝트 2개 생성 → DSN 시크릿 주입 | **사용자** |
| 5 | GitHub vars/secrets 설정 (아래 섹션) | **사용자(gh)** |
| 6 | main 푸시 → deploy 워크플로우 (이미지 빌드 → migrate job → 3서비스 배포) | 자동 |
| 7 | 배치 audience 대조·수동 트리거 확인 (아래 "배치" 섹션) | **사용자** |
| 8 | Toss 웹훅/콜백 URL·OAuth redirect URI를 새 api 주소로 등록 | **사용자(각 콘솔)** |
| 9 | 스테이징 DB에 일회성 `bootstrap_admin.py create`로 관리자 생성 + `apps/worker/scripts/seed_motifs.py`로 모티프 카탈로그 입력 (`apps/api/scripts/seed.py`는 local/test 전용) | **사용자** |

## 시크릿 값 주입 (수집해 둔 기존 env → Secret Manager)

컨테이너(secret id)는 tofu가 만들고 **값은 gcloud로만** 주입 — 시크릿 커밋 금지.

```bash
printf '%s' '<값>' | gcloud secrets versions add toss-secret-key --data-file=- --project=essesion-staging
# 동일하게: solapi-api-key solapi-api-secret google-client-secret kakao-client-secret
#          openai-api-key gemini-api-key recraft-api-key jwt-secret session-secret
#          sentry-dsn-api sentry-dsn-worker
# db-password·database-url은 tofu가 생성·주입하므로 손대지 않는다
# 전 시크릿에 버전이 1개 이상 있어야 서비스 리비전이 기동한다 (부트스트랩 3-1 참조)
```

프론트 env는 Cloudflare 환경변수(wrangler secret / 대시보드)로 — 6단계 프론트 배포 시.

## GitHub Actions 연결 (apply 후 1회)

```bash
tofu output   # wif_provider, deployer_sa, api_url 확인
gh variable set GCP_PROJECT_ID -b essesion-staging
gh variable set GCP_REGION -b asia-northeast3
gh variable set GCP_WIF_PROVIDER -b "$(tofu output -raw wif_provider)"
gh variable set GCP_DEPLOYER_SA -b "$(tofu output -raw deployer_sa)"
gh variable set CLOUDFLARE_ACCOUNT_ID -b <account-id>
gh secret set CLOUDFLARE_API_TOKEN
```

deploy/preview 워크플로우는 위 vars가 비어 있으면 스킵되므로, 설정 전에도 CI는 초록이다.

## 스키마 마이그레이션 (Cloud Run job `migrate`)

스키마 적용 경로는 deploy 워크플로우의 **migrate job**이다: 이미지 푸시 후·서비스 배포 전에 `gcloud run jobs update migrate --image ... && gcloud run jobs execute migrate --wait`. 실패하면(비-0 종료) 서비스 배포가 중단된다(잡은 `max_retries=0` — 자동 재시도 없음, 사람이 개입).

**첫 개통 시 주의**: `tofu apply` 직후의 migrate job은 placeholder 이미지라 실행 불가. 첫 이미지 푸시(main 머지 → deploy 성공) 전에 수동 실행이 필요하면:

```bash
gcloud run jobs update migrate --region asia-northeast3 --image <푸시된-api-이미지>
gcloud run jobs execute migrate --region asia-northeast3 --wait
```

## 초기 관리자 bootstrap·세션 복구

`apps/api/scripts/seed.py`는 local/test 전용이다. 스테이징·운영 관리자는 migrate 완료
후 DB에 연결할 수 있는 운영자 단말에서 아래 일회성 명령으로 만든다. 비밀번호는
명령행 인자나 저장 파일에 남기지 않고 임시 환경 변수로만 전달한다.

```bash
printf 'Admin email: '
read -r BOOTSTRAP_ADMIN_EMAIL
printf 'Admin password (12+ chars): '
read -rs BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
uv run python apps/api/scripts/bootstrap_admin.py create
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

이미 admin 계정이 있으면 `create`는 실패한다. 비밀번호 유출·분실 대응은 같은 방식으로
환경 변수를 준비한 뒤 `reset-password`를 실행한다. 비밀번호 변경 없이 해당 계정의
관리자 세션만 즉시 폐기하려면 이메일만 export하고 `revoke-sessions`를 실행한다.
두 명령 모두 store 세션은 건드리지 않는다.

```bash
uv run python apps/api/scripts/bootstrap_admin.py reset-password
uv run python apps/api/scripts/bootstrap_admin.py revoke-sessions
```

배포 확인은 `/healthz`가 아니라 `/readyz`를 사용한다. 스테이징·운영에서
`toss`, `gcs`, `solapi` 중 하나라도 `unavailable`이면 503이다. Toss·GCS mutation은
503으로 차단되고 Solapi 알림은 가짜 성공으로 바뀌지 않고 outbox `failed`로 남는다.

## 배치 (Cloud Scheduler → api /batch/*)

apply 시 `batch-{auto-confirm-orders,cancel-stale-orders,cleanup-images}` 잡 3종이 생성된다(스케줄은 `scheduler.tf`, KST 기준). api의 검증 env(`BATCH_OIDC_AUDIENCE`, `BATCH_INVOKER_EMAIL`)는 tofu가 주입 — 수동 조치 없음. 로컬 개발은 `batch_token` 폴백.

**apply 후 확인 (audience 불일치 = 배치 전원 401 조용한 실패)**:

```bash
tofu output -raw api_url   # scheduler.tf의 batch_audience(https://api-<project#>.<region>.run.app 형식)와 일치해야 함
gcloud scheduler jobs run batch-cancel-stale-orders --location asia-northeast3   # api 로그에서 200 확인
```

## Sentry (수동 1회)

sentry.io에서 api·worker 프로젝트 2개 생성 → DSN을 `sentry-dsn-api`·`sentry-dsn-worker` 시크릿에 주입. 코드 골격(`libs/obs`)은 `SENTRY_DSN` env가 있을 때만 초기화하므로 로컬에선 무해.

## Cloudflare

[cloudflare/README.md](./cloudflare/README.md) 참조.
