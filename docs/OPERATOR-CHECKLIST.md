# 운영자 직접 작업 목록 (사용자 액션)

코드·IaC·CI는 전부 준비 완료 — 아래는 **자동화할 수 없는 계정·콘솔·로컬 실행 작업**만 모은 것이다.
기준: [CHECKLIST.md](./CHECKLIST.md)의 미완([ ]) 항목. 명령 상세는 [infra/README.md](../infra/README.md)의 "부트스트랩"·"개통 체크리스트" 참조.

## 판정 요약 — CHECKLIST 미완 항목별

| CHECKLIST 항목 | 직접 작업? | 내용 |
|---|---|---|
| 1단계 · OpenTofu apply | **예** | 아래 A1~A3 |
| 1단계 · Cloudflare | **예 — 단 5단계·도메인 확정 후** | 아래 C |
| 1단계 · GCP 예산 알림 + uptime check | **아니오** | tofu apply(A3)에 포함 — 자동 생성. 단 실행자에게 청구 계정 권한 필요 |
| 1단계 · Sentry 연결 | **예** | 아래 A4 |
| 1단계 · Secret Manager env 배치 | **예** | 아래 A2 (값 주입은 사람만 가능) |
| 4단계 · 두 서비스 배포 | **절반** | 배포 자체는 main 푸시로 자동 — 선행(A1~A5)과 배포 후 확인(B)이 직접 작업 |
| 5단계 · admin 재작성 | **아니오 — 완료** | A~J 구현, 전체 자동 gate와 로컬 실제 API·PostgreSQL·Aside 검증 완료. 아래 D는 스테이징 운영 확인 |
| 5단계 · Playwright admin smoke | **아니오 — 완료** | spec·CI 연결 및 최종 스키마의 실제 PostgreSQL seed 로컬 실행 통과 |

---

## A. 스테이징 개통 (지금 가능 — 순서대로)

### A1. GCP 프로젝트 부트스트랩
```bash
gcloud projects create essesion-staging
gcloud billing projects link essesion-staging --billing-account=XXXXXX-XXXXXX-XXXXXX
gcloud storage buckets create gs://essesion-staging-tfstate \
  --project=essesion-staging --location=asia-northeast3 --uniform-bucket-level-access
```
- 예산 알림 생성을 위해 실행 계정에 **Billing Account Administrator/Costs Manager** 권한 필요.

### A2. tofu 1차 apply(-target) + 시크릿 값 주입
```bash
cd infra
brew install opentofu
cp staging.tfvars.example staging.tfvars   # 값 채우기
tofu init -backend-config="bucket=essesion-staging-tfstate"
tofu apply -var-file=staging.tfvars \
  -target=google_secret_manager_secret.app \
  -target=google_secret_manager_secret_version.database_url \
  -target=google_sql_user.app
```
그 다음 **0단계에서 수집해 둔 기존 env 값**을 주입 (전 시크릿에 버전 1개 이상 필수 — 없으면 서비스 리비전이 기동 실패):
```bash
printf '%s' '<값>' | gcloud secrets versions add <시크릿ID> --data-file=- --project=essesion-staging
```
대상 13종: `toss-secret-key` `solapi-api-key` `solapi-api-secret` `google-client-secret` `kakao-client-secret` `openai-api-key` `gemini-api-key` `recraft-api-key` `jwt-secret` `session-secret` `edge-proxy-secret` `sentry-dsn-api` `sentry-dsn-worker`
(`db-password`·`database-url`은 tofu가 주입 — 손대지 않는다. sentry 2종은 A4 후 주입해도 됨)

### A3. tofu 전체 apply
```bash
tofu apply -var-file=staging.tfvars
```
- 이때 자동 생성: Cloud Run 3서비스 + migrate job, Cloud SQL(PITR), Cloud Tasks, **Cloud Scheduler 배치 3종**, GCS, IAM/WIF, **예산 알림 + uptime check**(1단계 26행은 여기서 해소).

### A4. Sentry (수동 1회)
sentry.io에서 `api`·`worker` 프로젝트 2개 생성 → DSN을 `sentry-dsn-api`·`sentry-dsn-worker` 시크릿에 주입(A2 명령 재사용).

### A5. GitHub 연결
```bash
cd infra && tofu output   # wif_provider, deployer_sa 확인
gh variable set GCP_PROJECT_ID -b essesion-staging
gh variable set GCP_REGION -b asia-northeast3
gh variable set GCP_WIF_PROVIDER -b "$(tofu output -raw wif_provider)"
gh variable set GCP_DEPLOYER_SA -b "$(tofu output -raw deployer_sa)"
```
(Cloudflare vars/secrets는 C 단계에서.) 추가로 레포에 **Renovate GitHub App 설치**(1단계 25행 주석)가 아직이면 이때 함께.

## B. 배포 실행·확인 (A 완료 후)

1. **main에 머지/푸시** → deploy 워크플로우가 자동으로: 이미지 빌드 → **migrate job 실행**(스키마 적용) → api·worker-generate·worker-finalize 배포.
2. 준비 상태 확인: `curl -fsS "$(tofu output -raw api_url)/readyz"`가 200이고 `toss`·`gcs`·`solapi`가 `real`인지 확인한다. 503이면 필수 secret/bucket/plain env 누락을 먼저 수정한다.
3. 배치 확인: `tofu output -raw api_url`이 scheduler audience 형식(`https://api-<project#>.<region>.run.app`)과 일치하는지 대조 → `gcloud scheduler jobs run batch-cancel-stale-orders --location asia-northeast3` → api 로그 200 확인.
4. 초기 관리자와 모티프 입력 (로컬에서 스테이징 DB로 — cloud-sql-proxy 등으로 `DATABASE_URL` 지정):
   ```bash
   printf 'Admin email: '
   read -r BOOTSTRAP_ADMIN_EMAIL
   printf 'Admin password (12+ chars): '
   read -rs BOOTSTRAP_ADMIN_PASSWORD
   printf '\n'
   export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   uv run python apps/api/scripts/bootstrap_admin.py create
   unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   uv run python apps/worker/scripts/seed_motifs.py # 모티프 시드 카탈로그 5종
   ```
   `apps/api/scripts/seed.py`는 local/test 전용이다. `create`는 이미 admin 계정이 있으면 실패한다. 유출·분실 시 같은 환경 변수 방식으로 `reset-password`, 비밀번호 변경 없이 강제 로그아웃할 때 이메일만 지정해 `revoke-sessions`를 실행한다. 두 명령은 admin refresh session만 폐기한다.
5. 외부 콘솔 등록 — zone 연결 전이므로 **Cloud Run URL**(`tofu output api_url`) 기준, C 완료 후 `api.essesion.shop`으로 갱신/추가:
   - **Toss** 대시보드: 웹훅 URL → `<api_url>/payments/webhook`, successUrl 콜백 경로 갱신
   - **Google·Kakao** 콘솔: redirect URI → `<api_url>/auth/{provider}/callback`
   - Solapi 발신번호·PF ID·승인된 템플릿 3종은 `staging.tfvars`의 `api_extra_env`로 (`SOLAPI_SENDER_NUMBER`, `SOLAPI_PF_ID`, `SOLAPI_TEMPLATE_CLAIM_DONE`, `SOLAPI_TEMPLATE_CLAIM_REJECTED`, `SOLAPI_TEMPLATE_QUOTE_RECEIVED`)

## C. Cloudflare zone 연결 (도메인 `essesion.shop` 확정 — 실행은 5단계 프론트 배포 시점)

- Cloudflare에 `essesion.shop` zone 추가(네임서버 이전) → 서브도메인 `app.`/`admin.`/`api.essesion.shop` 라우트(각 `wrangler.jsonc`에 주석으로 준비돼 있음 — 해제만) + api 프록시 `ORIGIN` 교체 + `edge-proxy-secret`/`EDGE_SHARED_SECRET` 동일 값 주입 + WAF/레이트리밋 — [infra/cloudflare/README.md](../infra/cloudflare/README.md)
- `gh variable set CLOUDFLARE_ACCOUNT_ID` + `gh secret set CLOUDFLARE_API_TOKEN`
- `staging.tfvars`의 `api_extra_env`에 `FRONTEND_ORIGIN=https://app.essesion.shop`/`CORS_ORIGINS`/OAuth client id 채우고 `tofu apply`
- OAuth redirect URI·Toss 웹훅을 `https://api.essesion.shop` 기준으로 갱신 (B4에서 run.app으로 등록했던 것)
- `curl -I https://admin.essesion.shop/login`으로 `Content-Security-Policy`의 `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`를 확인하고, Cloud Run URL의 `/admin/*` 직접 요청은 edge secret 없이 403인지 확인
- api `min-instances=1` 상향은 프로덕션 전환 시(`api_min_instances` 변수)

## D. Admin 스테이징 운영 확인 (로컬 출시 판정 완료 후)

[`plans/admin-rewrite.md`](./plans/admin-rewrite.md)의 A~J와 `CHECKLIST.md`의 `admin 재작성`·`Playwright admin 스모크`는 2026-07-12 로컬 출시 검증으로 완료됐다. 아래 1~3은 완료 증거이며, 4~7은 GCP·Cloudflare 개통 뒤 실제 외부 capability와 운영 절차를 확인하는 스테이징 게이트다. 이 게이트는 admin 구현 완료를 다시 열지 않고 별도 배포·리허설 항목을 닫는다.

1. **완료** — 마지막 API 변경을 포함한 `pnpm codegen` 생성물 drift 0, `uv run pytest` 535건, ruff·pyright, `pnpm lint`, `pnpm turbo build typecheck test`를 통과했다.
2. **완료** — 실제 API와 PostgreSQL seed로 `e2e/admin-smoke.spec.ts`를 실행해 관리자 로그인 → 보호 목록/상세 → 대표 상태 변경 → 로그아웃을 확인했다.
3. **완료** — Aside 하네스로 1440/390/767/768/1024px와 200% zoom에서 주문·클레임 mutation, 상품 편집, 안전한 SVG, 모바일 메뉴·table scroll·dialog focus 복귀·reduced motion·탭 간 logout을 확인했다.
4. `/readyz`와 admin 대시보드에서 `gcs`(비공개 업로드/read)와 `gcs_assets`(공개 상품·생성 결과)가 각각 `real`인지 확인한다. 둘 중 하나라도 `unavailable`이면 관련 mutation을 진행하지 않는다.
5. 관리자 role 변경·비활성화·비밀번호 유출 대응에는 `bootstrap_admin.py revoke-sessions` 또는 `reset-password`를 사용한다. 모든 access token은 발급 시 role/current role 일치를 요구하고 admin token은 `session_kind=admin`도 요구하므로 역할 변경 직후 기존 access 요청은 401이며, refresh session도 별도로 폐기한다.
6. Toss confirm/refund가 timeout·5xx로 끝나면 같은 요청을 수동 재시도하지 않는다. 외부 호출 전에 생성된 open payment incident를 `/incidents`에서 확인하고 Toss 조회 기반 대사 → 금액 검증 → 멱등 반영 → memo 해결 순서만 사용한다.
7. 상품·주문·견적·리폼 업로드는 API가 돌려준 `x-goog-if-generation-match: 0` header를 포함해 한 번만 PUT하고, custom/sample 주문 참고 이미지는 완료된 `upload_id`만 주문 body에 전달하는 smoke를 포함한다.

## 완료 시 CHECKLIST 갱신

A~B가 끝나면 CHECKLIST 1단계 21·26·27·28행과 4단계 58행(+2단계 35행의 "스테이징 적용"), C가 끝나면 1단계 22행을 [x]로 바꾼다. D의 4~7은 스테이징 배포·리허설의 운영 증거로 기록한다. 5단계의 `admin 재작성`과 `Playwright admin 스모크`는 로컬 출시 검증으로 이미 완료됐다.
