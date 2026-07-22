# infra — OpenTofu (스테이징)

스테이징은 **별도 GCP 프로젝트로 격리** (ARCHITECTURE §8). 프로덕션은 7단계에서 같은 구성을 다른 project_id로 재사용.

아래 명령은 별도 표기가 없으면 모두 **저장소 루트**에서 실행한다.

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
cp infra/staging.tfvars.example infra/staging.tfvars   # 값 채우기
tofu -chdir=infra init -backend-config="bucket=essesion-staging-tfstate"

# 3-1. 시크릿 컨테이너·DB부터 — 서비스가 참조할 시크릿을 먼저 만들고 값을 주입
tofu -chdir=infra apply -var-file=staging.tfvars \
  -target=google_secret_manager_secret.app \
  -target=google_secret_manager_secret_version.database_url \
  -target=google_sql_user.app
```

여기서 멈추고 Sentry 프로젝트를 만든 뒤 아래 "시크릿 값 주입"을 수행한다. 전 서버
시크릿에 버전이 하나 이상 생긴 것을 확인한 후에만 전체 apply를 실행한다.

```bash
# 3-2. 전체 apply
tofu -chdir=infra apply -var-file=staging.tfvars
```

주의: `google_billing_budget`은 실행자에게 청구 계정 권한(Billing Account Administrator/Costs Manager)이 필요하다.

## 개통 체크리스트 (사용자 액션 ↔ 자동화 구분)

| # | 액션 | 주체 |
|---|---|---|
| 1 | GCP 프로젝트 생성·청구 연결·tfstate 버킷 (위 부트스트랩 1~2) | **사용자(gcloud)** |
| 2 | `staging.tfvars` 작성 (`public_api_origin` + 비시크릿 `api_extra_env`) | **사용자** |
| 3 | 3-1 target apply로 시크릿 컨테이너·DB 생성 | **사용자(로컬 tofu)** |
| 4 | Sentry api·worker·store 프로젝트 생성 → 전 서버 시크릿 값 주입 | **사용자** |
| 5 | 3-2 전체 apply | **사용자(로컬 tofu)** |
| 6 | GitHub vars/secrets와 프런트 build-time env 설정 (아래 섹션) | **사용자(gh)** |
| 7 | 고정된 `api.essesion.shop` route에 Cloud Run ORIGIN·edge secret을 주입해 API 프록시를 선배포 | **사용자(Cloudflare/wrangler)** |
| 8 | main push CI 성공 → deploy 워크플로우 (이미지 빌드 → migrate job → 3서비스 배포) | 자동 |
| 9 | API·두 worker readiness, 프록시·직통 차단, 배치 audience와 수동 트리거 확인 | **사용자** |
| 10 | Toss 웹훅/콜백 URL·OAuth redirect URI를 `https://api.essesion.shop` 기준으로 등록 | **사용자(각 콘솔)** |
| 11 | 스테이징 DB에 일회성 `bootstrap_admin.py create`로 관리자 생성 + `seed_motifs.py` → `backfill_motif_embeddings.py --confirm-live` → `sync_authoring_examples.py --confirm-live` 실행, 두 출력의 `embedded=total` 확인 (`apps/api/scripts/seed.py`는 local/test 전용) | **사용자** |

## 시크릿 값 주입

컨테이너(secret id)는 tofu가 만들고 **값은 gcloud로만** 주입한다. 먼저 Sentry에서
`api`·`worker`·`store` 프로젝트를 만든다. `api`·`worker` DSN은 Secret Manager에,
`store` DSN은 아래 GitHub build-time 변수에 넣는다. 시크릿을 커밋하거나 shell 변수에
오래 보관하지 않는다.

```bash
printf '%s' '<값>' | gcloud secrets versions add toss-secret-key --data-file=- --project=essesion-staging
# 수집한 기존 값: solapi-api-key solapi-api-secret google-client-secret kakao-client-secret
#                 naver-client-secret recraft-api-key
#                 sentry-dsn-api sentry-dsn-worker
# apple-private-key는 .p8 파일을 통째로: gcloud secrets versions add apple-private-key --data-file=<AuthKey.p8 경로>

# 새 환경마다 독립적으로 생성할 값(각 명령을 따로 실행)
openssl rand -base64 48 | gcloud secrets versions add jwt-secret --data-file=- --project=essesion-staging
openssl rand -base64 48 | gcloud secrets versions add session-secret --data-file=- --project=essesion-staging
openssl rand -base64 48 | gcloud secrets versions add edge-proxy-secret --data-file=- --project=essesion-staging
# db-password·database-url은 tofu가 생성·주입하므로 손대지 않는다
# 전 서버 시크릿에 버전이 1개 이상 생긴 뒤에만 3-2 전체 apply를 실행한다
```

`VITE_*` 값은 Cloudflare 런타임 변수가 아니라 Vite **빌드 시점** GitHub 변수다.
Toss client key와 store Sentry DSN은 공개 가능한 클라이언트 설정이지만 값 누락은 배포를
막으므로 아래 연결 단계에서 반드시 등록한다.

## GitHub Actions 연결 (apply 후 1회)

```bash
tofu -chdir=infra output   # wif_provider, deployer_sa, api_url 확인
gh variable set GCP_PROJECT_ID -b essesion-staging
gh variable set GCP_REGION -b asia-northeast3
gh variable set GCP_WIF_PROVIDER -b "$(tofu -chdir=infra output -raw wif_provider)"
gh variable set GCP_DEPLOYER_SA -b "$(tofu -chdir=infra output -raw deployer_sa)"
gh variable set CLOUDFLARE_ACCOUNT_ID -b <account-id>
gh secret set CLOUDFLARE_API_TOKEN
gh variable set VITE_API_BASE_URL -b https://api.essesion.shop
gh variable set VITE_TOSS_CLIENT_KEY -b <스테이징-Toss-client-key>
gh variable set VITE_SENTRY_DSN -b <store-Sentry-DSN>
gh variable set VITE_SENTRY_ENVIRONMENT -b staging
```

deploy/preview 워크플로우는 위 vars가 비어 있으면 스킵되므로, 설정 전에도 CI는 초록이다.

## 스키마 마이그레이션 (Cloud Run job `migrate`)

스키마 적용 경로는 deploy 워크플로우의 **migrate job**이다: 이미지 푸시 후·서비스 배포 전에 `gcloud run jobs update migrate --image ... && gcloud run jobs execute migrate --wait`. 실패하면(비-0 종료) 서비스 배포가 중단된다(잡은 `max_retries=0` — 자동 재시도 없음, 사람이 개입). migration 직전 main tip이 대상 SHA인지 마지막으로 확인하며, migration이 시작되면 그 시점을 point-of-no-return으로 삼아 main이 전진해도 같은 SHA의 API·worker·Cloudflare 배포까지 끝낸다. 단일 배포 큐가 다음 SHA를 이어서 배포한다.

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

배포 확인은 `/healthz`가 아니라 공개 프록시의 `https://api.essesion.shop/readyz`를 사용한다.
Cloud Run `run.app` 직통 `/readyz`는 exact edge header 없이 403이다. API 응답에서
`database=ready`, `toss/gcs/gcs_assets/solapi/finalize_tasks=real`, `worker=ready`,
`batch_auth=oidc`, `oauth_google/oauth_kakao/auth_secrets/edge_proxy=ready`를 모두 확인한다.
하나라도 `unavailable`이면 503이다. Toss·GCS mutation은 503으로 차단되고 Solapi 알림은
가짜 성공으로 바뀌지 않고 outbox `failed`로 남는다.

두 worker는 비공개 서비스이므로 `roles/run.invoker`가 있는 점검 계정으로 각각 직접
readiness를 확인한다. 두 응답 모두 `database=ready`, `gcs_assets=real`이어야 한다.

```bash
GENERATE_URL="$(tofu -chdir=infra output -raw worker_generate_url)"
FINALIZE_URL="$(tofu -chdir=infra output -raw worker_finalize_url)"
curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="$GENERATE_URL")" "$GENERATE_URL/readyz"
curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token --audiences="$FINALIZE_URL")" "$FINALIZE_URL/readyz"
```

### Plan v3 예시 projection과 승격

migrate와 공개 motif embedding이 끝난 뒤, DB/ADC가 연결된 운영자 환경에서 Git의
`gallery-v1` 25개를 불변 projection으로 동기화한다. 출력이 정확히
`embedded=25/25 set=gallery-v1`이어야 shadow를 시작한다.

```bash
uv run python apps/worker/scripts/build_authoring_examples.py --check
uv run python apps/worker/scripts/sync_authoring_examples.py --confirm-live
uv run python apps/worker/scripts/eval_authoring.py \
  --confirm-live --pipeline legacy --pipeline v3
```

평가 뒤 `staging.tfvars`의 `worker_generate_extra_env`를 `legacy → shadow → canary → v3`
순서로 바꾸고 tofu apply한다. 즉시 롤백은 `AUTHORING_PIPELINE_MODE=legacy`다. DB에서
prompt/예시를 직접 수정하거나 관리자 화면을 통해 설정하지 않는다. revision 변경과 상세
관측 필드는 [authoring-plan-v3.md](../docs/specs/authoring-plan-v3.md)를 따른다.

## 배치 (Cloud Scheduler → api /batch/*)

apply 시 `batch-{auto-confirm-orders,cancel-stale-orders,reconcile-stale-generation-jobs,cleanup-images}` 잡 4종이 생성된다(스케줄은 `scheduler.tf`, KST 기준). api의 검증 env(`BATCH_OIDC_AUDIENCE`, `BATCH_INVOKER_EMAIL`)는 tofu가 주입 — 수동 조치 없음. 로컬 개발은 `batch_token` 폴백.

**apply 후 확인 (audience 불일치 = 배치 전원 401 조용한 실패)**:

```bash
tofu -chdir=infra output -raw api_url   # scheduler.tf의 batch_audience와 일치해야 함
gcloud scheduler jobs run batch-cancel-stale-orders --location asia-northeast3   # api 로그에서 200 확인
```

## Sentry (수동 1회)

sentry.io에서 api·worker·store 프로젝트 3개를 만든다. api·worker DSN은
`sentry-dsn-api`·`sentry-dsn-worker` 시크릿에, store DSN은 GitHub
`VITE_SENTRY_DSN` 변수에 주입한다. 코드 골격(`libs/obs`)과 store 초기화는 DSN이
있을 때만 동작하므로 로컬에서는 no-op이다.

## Cloudflare

첫 비로컬 API 배포 전에 API 프록시를 먼저 개통해야 한다. 일반 HTTP는 정확한
edge secret 없이는 Cloud Run에서 거부되며 `/healthz`와 자체 OIDC `/batch/*`만
예외다. readiness는 공개 Cloudflare 경로로 확인한다. 순서와 검증 명령은 [cloudflare/README.md](./cloudflare/README.md) 참조.
