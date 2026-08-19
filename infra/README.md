# infra — OpenTofu (production)

별도 staging 프로젝트 없이 **단일 production GCP 프로젝트**만 운영한다(ARCHITECTURE §0).

이 문서가 **개통 명령과 실행 순서의 정본**이다. 명령은 여기서만 복사한다.
별도 표기가 없으면 모두 **저장소 루트**에서 실행한다.

## 부트스트랩

프로젝트는 `ysindustry`(번호 801310318969, asia-northeast3), tofu 상태 버킷은 `gs://essesion-tfstate`.
**둘 다 이미 존재하므로 1·2는 재개통 때만 실행한다.**

```bash
# 1. 프로젝트 + 청구 연결 (완료 — 청구 계정 01ECA7-E30675-76BBED)
gcloud projects create ysindustry
gcloud billing projects link ysindustry --billing-account=XXXXXX-XXXXXX-XXXXXX

# 2. tofu 상태 버킷 (완료 — tofu 밖에서 생성. 닭·달걀)
gcloud storage buckets create gs://essesion-tfstate \
  --project=ysindustry --location=asia-northeast3 --uniform-bucket-level-access

# 3. 변수 채우고 init
brew install opentofu
cp infra/production.tfvars.example infra/production.tfvars   # 값 채우기
tofu -chdir=infra init -backend-config="bucket=essesion-tfstate"

# 3-1. 시크릿 컨테이너·DB 먼저 (시크릿 버전이 없으면 서비스 리비전이 기동 실패한다)
tofu -chdir=infra apply -var-file=production.tfvars \
  -target=google_secret_manager_secret.app \
  -target=google_secret_manager_secret_version.database_url \
  -target=google_sql_user.app
```

여기서 멈추고 Sentry 프로젝트를 만든 뒤 아래 [시크릿 값 주입](#시크릿-값-주입)을 수행한다.
**전 시크릿에 버전이 1개 이상 생긴 것을 확인한 후에만** 전체 apply를 실행한다.

```bash
# 3-2. 전체 apply
tofu -chdir=infra apply -var-file=production.tfvars
```

`google_billing_budget`은 실행자에게 청구 계정 권한(Billing Account Administrator/Costs Manager)이 필요하다.

## 시크릿 값 주입

컨테이너(secret id)는 tofu가 만들고 **값은 gcloud로만** 주입한다. 시크릿을 커밋하거나 shell 변수에 오래 보관하지 않는다.

```bash
# 외부에서 발급받아 수집하는 값 — 각 시크릿마다 따로 실행
printf '%s' '<값>' | gcloud secrets versions add '<시크릿ID>' --data-file=- --project=ysindustry
#   toss-secret-key  solapi-api-key  solapi-api-secret  openai-api-key
#   google-client-secret  kakao-client-secret  naver-client-secret
#   sentry-dsn-api  sentry-dsn-worker

# apple-private-key만 .p8 파일을 통째로
gcloud secrets versions add apple-private-key --data-file='<AuthKey.p8 경로>' --project=ysindustry

# 새 환경마다 독립적으로 생성하는 값 — tr -d '\n' 필수 (아래 주의 참조)
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add jwt-secret --data-file=- --project=ysindustry
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add session-secret --data-file=- --project=ysindustry
openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add edge-proxy-secret --data-file=- --project=ysindustry
```

**끝 개행 주의** — `openssl rand`는 출력 끝에 개행을 붙이고 Secret Manager는 그것까지 값으로 저장한다.
Cloud Run은 개행을 포함한 원본을 env에 넣지만 `wrangler secret put`은 파이프 입력의 개행을 잘라내므로,
`edge-proxy-secret`처럼 **두 시스템이 같은 값을 비교하는 시크릿은 개행 하나로 전부 403이 된다**
(api `EdgeProxyMiddleware`의 `compare_digest`). 붙여넣기로 넣을 때도 끝에 빈 줄이 없어야 한다.

`db-password`·`database-url`은 tofu가 생성·주입하므로 손대지 않는다.
`naver-client-secret`·`apple-private-key`도 `cloudrun.tf`가 `version="latest"`로 참조하므로
네이버·Apple을 아직 쓰지 않더라도 **버전이 없으면 api 리비전이 기동 실패**한다.

## GitHub Actions 연결 (apply 후 1회)

```bash
tofu -chdir=infra output   # wif_provider, deployer_sa, api_url 확인
gh variable set GCP_PROJECT_ID -b ysindustry
gh variable set GCP_REGION -b asia-northeast3
gh variable set GCP_WIF_PROVIDER -b "$(tofu -chdir=infra output -raw wif_provider)"
gh variable set GCP_DEPLOYER_SA -b "$(tofu -chdir=infra output -raw deployer_sa)"
gh variable set CLOUDFLARE_ACCOUNT_ID -b <account-id>
gh secret set CLOUDFLARE_API_TOKEN
gh variable set VITE_API_BASE_URL -b https://api.essesion.shop
gh variable set VITE_TOSS_CLIENT_KEY -b <production-Toss-client-key>
gh variable set VITE_SENTRY_DSN -b <store-Sentry-DSN>
gh variable set VITE_SENTRY_ENVIRONMENT -b production
gh variable set VITE_GA_MEASUREMENT_ID -b <GA4-측정-ID>
```

`VITE_*`는 Cloudflare 런타임 변수가 아니라 Vite **빌드 시점** 값이다. 다섯 개 중 하나라도
누락하면 프론트가 그 기능이 꺼진 채 배포된다(`VITE_GA_MEASUREMENT_ID` 누락 시 GA가 조용히 비활성).
deploy/preview 워크플로우는 위 vars가 비어 있으면 스킵되므로, 설정 전에도 CI는 초록이다.

## Sentry (수동 1회)

sentry.io에서 api·worker·store 프로젝트 3개를 만든다. api·worker DSN은
`sentry-dsn-api`·`sentry-dsn-worker` 시크릿에, store DSN은 GitHub `VITE_SENTRY_DSN`에 주입한다.
코드 골격(`libs/obs`)과 store 초기화는 DSN이 있을 때만 동작하므로 로컬에서는 no-op이다.

## Cloudflare — api 프록시 선개통

첫 비로컬 API 배포 **전에** 프록시를 개통해야 한다. 비로컬 api는 일반 HTTP 전체에서 정확한
edge 헤더를 필수로 검사하며 `/healthz`와 자체 OIDC를 검증하는 `/batch/*`만 예외다.

1. Cloudflare에 `essesion.shop` zone 추가(네임서버 이전).
2. edge secret 주입 — 값을 파일·셸 기록·커밋에 남기지 않도록 파이프로 전달한다.

```bash
gcloud secrets versions access latest --secret=edge-proxy-secret --project=ysindustry \
  | pnpm -C infra/cloudflare/api-proxy exec wrangler secret put EDGE_SHARED_SECRET
```

3. 첫 API 이미지 배포 전에 프록시를 선배포한다. `api.essesion.shop`은 `api-proxy/wrangler.jsonc`에
   **custom_domain**으로 고정돼 있어 wrangler가 DNS 레코드와 인증서까지 만든다(일반 route는 DNS를
   만들지 않아 더미 레코드가 따로 필요하다 — store·admin과 같은 방식으로 통일). Cloud Run URL은
   파일에 저장하지 않고 배포 시 `ORIGIN`으로 주입한다. DNS 전파에 1~2분 걸린다.

```bash
pnpm -C infra/cloudflare/api-proxy exec wrangler deploy \
  --var "ORIGIN:$(tofu -chdir=infra output -raw api_url)"
```

4. 대시보드 Security 규칙은 두지 않는다 — 레이트리밋은 api 내장 리미터
   (`apps/api/src/api/domains/auth/rate_limit.py`)가 담당하고, zone이 Free 플랜이라 edge 규칙으로는
   같은 한도를 표현할 수 없다. 판단 근거는 [기록](../docs/reviews/cloudflare-waf-rate-limits-2026-08-14.md).

5. Toss 웹훅과 OAuth redirect URI는 처음부터 `https://api.essesion.shop` 기준으로만 등록한다. Cloud Run `run.app` URL을 외부 콘솔에 등록하지 않는다.
6. 프론트 배포 뒤 `apps/store`·`apps/admin`의 고정 custom-domain route 연결을 확인한다.

## 스키마 마이그레이션 (Cloud Run job `migrate`)

스키마 적용 경로는 deploy 워크플로우의 **migrate job**이다: 이미지 푸시 후·서비스 배포 전에
`gcloud run jobs update migrate --image ... && gcloud run jobs execute migrate --wait`.
실패하면 서비스 배포가 중단된다(`max_retries=0` — 자동 재시도 없음, 사람이 개입).

**point-of-no-return**: migration 직전 main tip이 대상 SHA인지 마지막으로 확인한다. migration이
시작되면 main이 전진해도 같은 SHA의 API·worker·Cloudflare 배포까지 끝낸다. 단일 배포 큐가
다음 SHA를 이어서 배포한다.

**첫 개통 시 주의**: `tofu apply` 직후의 migrate job은 placeholder 이미지라 실행 불가. 첫 이미지
푸시(main 머지 → deploy 성공) 전에 수동 실행이 필요하면:

```bash
gcloud run jobs update migrate --region asia-northeast3 --image <푸시된-api-이미지>
gcloud run jobs execute migrate --region asia-northeast3 --wait
```

## Readiness 확인

배포 확인은 `/healthz`가 아니라 공개 프록시의 `/readyz`를 사용한다. `run.app` 직통은 exact edge
헤더 없이 403이다.

```bash
# 공개 프록시 200 / 직통 403 대조
curl -fsS 'https://api.essesion.shop/readyz'
curl -fsS 'https://api.essesion.shop/products?limit=1'
curl -sS -o /dev/null -w '%{http_code}\n' "$(tofu -chdir=infra output -raw api_url)/products?limit=1"   # 403

# 두 worker는 비공개 — 둘 다 database=ready 확인.
# --audiences는 서비스 계정 자격증명에서만 동작한다. 운영자 단말(사용자 계정)은 run.invoker를 가진
# SA를 임퍼소네이션해야 하고, 그러려면 자신에게 roles/iam.serviceAccountTokenCreator가 필요하다.
SA=run-api@ysindustry.iam.gserviceaccount.com
GENERATE_URL="$(tofu -chdir=infra output -raw worker_generate_url)"
FINALIZE_URL="$(tofu -chdir=infra output -raw worker_finalize_url)"
for u in "$GENERATE_URL" "$FINALIZE_URL"; do
  curl -fsS -H "Authorization: Bearer $(gcloud auth print-identity-token \
    --impersonate-service-account="$SA" --audiences="$u" --include-email)" "$u/readyz"
done
```

api `/readyz`에서 `database=ready`, `toss/solapi=real`, `worker=ready`,
`batch_auth=oidc`, `oauth_google/oauth_kakao/oauth_naver/oauth_apple/auth_secrets/edge_proxy=ready`를
모두 확인한다. 하나라도 `unavailable`이면 503이다. Toss·GCS mutation은 503으로 차단되고 Solapi
알림은 가짜 성공으로 바뀌지 않고 outbox `failed`로 남는다.

## 운영자 단말에서 DB 접속

아래 bootstrap·시드·마이그레이션 확인은 전부 운영자 단말이 production DB에 붙어야 한다.
`database-url` 시크릿은 Cloud Run 전용 유닉스 소켓 DSN(`?host=/cloudsql/...`)이라 단말에서
그대로 쓸 수 없고, 인스턴스에 authorized network도 없다. **cloud-sql-proxy가 유일한 경로다.**

```bash
cloud-sql-proxy "$(tofu -chdir=infra output -raw db_connection_name)" &   # 127.0.0.1:5432
DB_PASSWORD="$(gcloud secrets versions access latest --secret=db-password --project=ysindustry)"
export DATABASE_URL="postgresql+asyncpg://app:$DB_PASSWORD@127.0.0.1:5432/essesion"
unset DB_PASSWORD   # DSN에만 남기고 별도 변수로 보관하지 않는다
```

실행 계정에 `roles/cloudsql.client`가 필요하다(프로젝트 생성자는 owner로 이미 충족).
작업이 끝나면 프록시를 내리고(`kill %1`) `DATABASE_URL`을 `unset`한다.

## 초기 관리자 bootstrap·세션 복구

`apps/api/scripts/seed.py`는 local/test 전용이다. production 관리자는 migrate 완료 후 위
[DB 접속](#운영자-단말에서-db-접속)을 연결한 단말에서 아래 일회성 명령으로 만든다. 비밀번호는 명령행 인자나 저장
파일에 남기지 않고 임시 환경 변수로만 전달한다.

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

이미 admin 계정이 있으면 `create`는 실패한다. 비밀번호 유출·분실은 같은 방식으로 환경 변수를
준비한 뒤 `reset-password`. 비밀번호 변경 없이 관리자 세션만 즉시 폐기하려면 이메일만 export하고
`revoke-sessions`. 두 명령 모두 store 세션은 건드리지 않는다.

```bash
# reset-password — 이메일·새 비밀번호 둘 다 필요
printf 'Admin email: '
read -r BOOTSTRAP_ADMIN_EMAIL
printf 'New password (12+ chars): '
read -rs BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
uv run python apps/api/scripts/bootstrap_admin.py reset-password
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD

# revoke-sessions — 이메일만 필요
printf 'Admin email: '
read -r BOOTSTRAP_ADMIN_EMAIL
export BOOTSTRAP_ADMIN_EMAIL
uv run python apps/api/scripts/bootstrap_admin.py revoke-sessions
unset BOOTSTRAP_ADMIN_EMAIL
```

## Production 데이터 시드

[DB 접속](#운영자-단말에서-db-접속)을 연결하고 `OPENAI_API_KEY`를
Secret Manager에서 주입한 운영자 환경에서 migrate 뒤 **순서대로** 실행한다. 전부 멱등이며,
같은 ID가 이미 있으면 DB에서 큐레이션한 내용과 활성 상태를 보존한다.

```bash
uv run python apps/api/scripts/bootstrap_admin.py seed-config      # 무과금 — 설정·가격 초기행
uv run python apps/worker/scripts/seed_motifs.py
uv run python apps/worker/scripts/seed_design_examples.py            # 무과금 — 결정론 엔진, 외부 호출 없음
uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live
uv run python apps/worker/scripts/seed_authoring_examples.py --confirm-live
uv run python apps/worker/scripts/eval_authoring.py --confirm-live
```

`seed-config`를 **빠뜨리면 복구를 화면에서 못 한다** — 관리자 설정·가격 화면은 기존 행을 수정하는
구조라(`domains/admin/configuration.py`) 행이 없으면 만들 수가 없고, `admin_settings`가 비면
`/admin/settings`가 503, 단가 조회가 `token_cost_not_configured`, 견적이
`pricing_not_configured`로 떨어진다. 기존 행은 덮지 않으므로(운영자가 화면에서 조정한 값 보존)
재실행해도 안전하다. 값의 정본은 [money.md §6](../docs/api-spec/money.md)이고
초기값은 `api/config_defaults.py`가 로컬 시드와 공유한다.

`seed_design_examples.py`는 store 첫 진입 갤러리다. 빠뜨려도 장애는 아니지만 갤러리 섹션이
통째로 비어 배포된다. `backfill_motif_tags.py`는 **production에서 실행하지 않는다** — 새 DB에는
백필할 기존 모티프가 없고 유료 호출만 발생한다.

인덱싱 출력의 `embedded=<전체>/<전체>`와 starter 시드의 `source=bootstrap`을 배포 기록에 남기고,
admin Motif 상세에서 symbol의 concrete paint 표본을 확인한다. 인덱싱은 `user_upload`을 제외하며
`OPENAI_API_KEY` 또는 `--confirm-live`가 없으면 외부 호출과 DB 갱신을 시작하지 않는다.

승격 배치·직접 저작·관측 필드 계약은 [authoring-plan-v3.md](../docs/api-spec/authoring-plan-v3.md).

## 배치 (Cloud Scheduler → api /batch/*)

apply 시 잡 **4종**이 생성된다(스케줄은 `scheduler.tf`, KST 기준).

`batch-{auto-confirm-orders, cancel-stale-orders, cleanup-images, authoring-promotion-candidates}`

> **finalize 동기 전환 정리(1회)**: finalize가 Cloud Tasks 큐에서 동기 HTTP로 전환되면서
> `google_cloud_tasks_queue.finalize`·`tasks-invoker` SA·`batch-reconcile-stale-generation-jobs`
> 잡·`roles/cloudtasks.enqueuer`가 tf에서 제거됐다 — 다음 apply가 실제 리소스를 파괴한다.
> apply 전에 구 프로듀서를 멈춘 뒤 **task 단위로** 큐가 비었는지 확인한다 —
> `gcloud tasks list --queue=finalize --location=asia-northeast3` 출력이 비어 있어야 하며,
> `gcloud tasks queues describe finalize`는 보조 정보일 뿐 task 잔량의 증거가 아니다.
> 전환 배포 이후 `queued`/`processing`으로 남은 legacy `generation_jobs` 행은 폴링하는
> 클라이언트가 없으므로 그대로 두거나 사용자가 완성본 화면에서 삭제하면 된다.

api의 검증 env(`BATCH_OIDC_AUDIENCE`, `BATCH_INVOKER_EMAIL`)는 tofu가 주입하므로 수동 조치가 없다.
로컬 개발은 `batch_token` 폴백.

토큰 audience는 scheduler와 api env가 같은 `local.batch_audience`를 쓴다. api는 자기 URL이 아니라
그 문자열로 검증하므로(`deps.verify_batch_token`) **실제 `api_url`과 달라도 정상**이다 — Cloud Run이
배정하는 URL 형식은 프로젝트마다 다르다. 대조하지 말고 실제 호출로 확인한다.

**apply 후 확인 (401 = 배치 전원 조용한 실패)**:

```bash
gcloud scheduler jobs run batch-cancel-stale-orders --location asia-northeast3   # api 로그에서 200 확인
```
