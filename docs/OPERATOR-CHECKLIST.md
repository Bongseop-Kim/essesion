# 운영자 직접 작업 목록 (사용자 액션)

코드·IaC·CI로 자동화할 수 없는 계정·콘솔 작업과, 스테이징 리허설·컷오버에서
운영자가 직접 판정해야 하는 게이트를 모았다. 모든 명령은 별도 표기가 없으면
**저장소 루트**에서 실행한다.
기준: [CHECKLIST.md](./CHECKLIST.md)의 미완([ ]) 항목. 명령 상세는 [infra/README.md](../infra/README.md)의 "부트스트랩"·"개통 체크리스트" 참조.

## 판정 요약 — CHECKLIST 미완 항목별

| CHECKLIST 항목 | 직접 작업? | 내용 |
|---|---|---|
| 1단계 · OpenTofu apply | **예** | 아래 A1~A4 |
| 1단계 · Cloudflare | **예 — API 프록시는 첫 API 배포 전 필수** | 아래 A5, 프론트 route는 C |
| 1단계 · GCP 예산 알림 + uptime check | **아니오** | tofu 전체 apply(A4)에 포함 — 자동 생성. 단 실행자에게 청구 계정 권한 필요 |
| 1단계 · Sentry 연결 | **예** | 아래 A3 |
| 1단계 · Secret Manager env 배치 | **예** | 아래 A3 (값 주입은 사람만 가능) |
| 4단계 · 두 서비스 배포 | **절반** | 배포 자체는 main 푸시로 자동 — 선행(A1~A5)과 배포 후 확인(B)이 직접 작업 |
| 5단계 · admin 재작성 | **아니오 — 완료** | A~J 구현, 전체 자동 gate와 로컬 실제 API·PostgreSQL·Aside 검증 완료. 아래 D는 스테이징 운영 확인 |
| 5단계 · Playwright admin smoke | **아니오 — 완료** | spec·CI 연결 및 최종 스키마의 실제 PostgreSQL seed 로컬 실행 통과 |
| 6단계 · 리허설 | **예** | 아래 E — 외부 연동·데이터 이관·개인정보 정책 판정 |
| 7단계 · 컷오버 | **예** | 아래 F — production 전환·롤백·Supabase 종료 |

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

### A2. tofu 1차 apply(-target)
```bash
brew install opentofu
cp infra/staging.tfvars.example infra/staging.tfvars   # 값 채우기
tofu -chdir=infra init -backend-config="bucket=essesion-staging-tfstate"
tofu -chdir=infra apply -var-file=staging.tfvars \
  -target=google_secret_manager_secret.app \
  -target=google_secret_manager_secret_version.database_url \
  -target=google_sql_user.app
```
`staging.tfvars`의 `public_api_origin`은 `https://api.essesion.shop`으로 유지한다. `api_extra_env`에는 첫 apply부터 `FRONTEND_ORIGIN=https://app.essesion.shop`, `ADMIN_FRONTEND_ORIGIN=https://admin.essesion.shop`, 두 origin의 `CORS_ORIGINS`, OAuth client id를 넣는다. 비로컬 API가 localhost로 redirect하거나 관리자 origin을 잘못 판정하는 중간 리비전을 만들지 않는다.

### A3. Sentry 3개 프로젝트 + 시크릿 값 주입

Sentry에서 `api`·`worker`·`store` 프로젝트를 만든다. api·worker DSN은 아래 서버
시크릿에 넣고 store DSN은 A5의 GitHub build-time 변수로 넣는다.

**0단계에서 수집한 provider 값**을 주입한다. 전 서버 시크릿에 버전이 하나 이상
없으면 전체 apply의 서비스 리비전이 기동하지 않는다.

```bash
printf '%s' '<값>' | gcloud secrets versions add <시크릿ID> --data-file=- --project=essesion-staging

# 새 환경마다 독립적으로 생성(각 명령을 따로 실행)
openssl rand -base64 48 | gcloud secrets versions add jwt-secret --data-file=- --project=essesion-staging
openssl rand -base64 48 | gcloud secrets versions add session-secret --data-file=- --project=essesion-staging
openssl rand -base64 48 | gcloud secrets versions add edge-proxy-secret --data-file=- --project=essesion-staging
```
수집값 대상: `toss-secret-key` `solapi-api-key` `solapi-api-secret`
`google-client-secret` `kakao-client-secret` `openai-api-key` `gemini-api-key`
`recraft-api-key` `sentry-dsn-api` `sentry-dsn-worker`. `db-password`·`database-url`은
tofu가 생성·주입하므로 손대지 않는다.

### A4. tofu 전체 apply
```bash
tofu -chdir=infra apply -var-file=staging.tfvars
```
- 이때 자동 생성: Cloud Run 3서비스 + migrate job, Cloud SQL(PITR), Cloud Tasks,
  **Cloud Scheduler 배치 4종**, GCS, IAM/WIF, **예산 알림 + uptime check**.

### A5. Cloudflare API 프록시 선개통 + GitHub 연결

`tofu -chdir=infra output -raw api_url`이 생기면 첫 API 이미지 배포 전에 아래를 완료한다.

1. Cloudflare에 `essesion.shop` zone을 추가하고 네임서버를 이전한다.
2. `infra/cloudflare/api-proxy/wrangler.jsonc`에 고정된 `api.essesion.shop/*` route를 확인한다. Cloud Run URL은 파일에 저장하지 않고 배포 명령으로 주입한다.
3. A3에서 Secret Manager에 넣은 값을 그대로 `EDGE_SHARED_SECRET`에 주입한다. 값을 화면이나 파일로 남기지 않도록 `gcloud secrets versions access latest --secret=edge-proxy-secret --project=essesion-staging | pnpm -C infra/cloudflare/api-proxy exec wrangler secret put EDGE_SHARED_SECRET`처럼 파이프로 전달한다.
4. `pnpm -C infra/cloudflare/api-proxy exec wrangler deploy --var "ORIGIN:$(tofu -chdir=infra output -raw api_url)"`로 프록시를 먼저 배포하고, 관리형 WAF와 `/auth/login`·`/auth/phone/verify`·`/payments/webhook`별 IP rate limit을 설정한다. 무과금 helper인 `POST /design/ideas`에도 별도 IP rate limit을 적용한다(API 인스턴스 내부의 사용자별 6회/60초 제한은 전역 quota가 아니다).

전체 절차와 검증은 [infra/cloudflare/README.md](../infra/cloudflare/README.md)를 따른다. 일반 API 요청은 이 프록시가 덮어쓰는 secret 없이는 거부되므로 이 단계를 건너뛰고 API부터 배포하지 않는다.

```bash
tofu -chdir=infra output   # wif_provider, deployer_sa 확인
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
`VITE_*`는 Cloudflare 런타임 설정이 아니라 Vite 빌드 시점 변수다. 네 항목 중 하나라도
누락하지 않는다. 레포에 **Renovate GitHub App 설치**가 아직이면 이때 함께한다.

## B. 배포 실행·확인 (A 완료 후)

1. A5 프록시 선개통을 확인한 뒤 **main에 머지/푸시**한다. 해당 SHA의 push CI가 성공하면 deploy 워크플로우가 단일 큐에서 이미지 빌드 → **migrate job 실행**(스키마 적용) → api·worker-generate·worker-finalize 배포 → Cloudflare workers 재배포를 수행한다. migration 시작이 point-of-no-return이므로 이후 main이 전진해도 같은 SHA의 나머지 배포를 중단하지 않으며, 다음 SHA는 단일 큐에서 이어서 배포된다. 수동 dispatch는 제공하지 않으며 필요하면 성공한 CI run의 deploy workflow를 rerun한다.
2. 준비 상태 확인: `curl -fsS 'https://api.essesion.shop/readyz'`가 200이고 `database=ready`, `toss/gcs/gcs_assets/solapi/finalize_tasks=real`, `worker/oauth_google/oauth_kakao/auth_secrets/edge_proxy=ready`, `batch_auth=oidc`인지 확인한다. `curl -sS -o /dev/null -w '%{http_code}' "$(tofu -chdir=infra output -raw api_url)/readyz"`는 exact edge header 없이 403이어야 한다. 503이면 필수 secret/bucket/plain env 누락을 먼저 수정한다.
3. `roles/run.invoker`가 있는 점검 계정으로 `worker_generate_url`과 `worker_finalize_url`의 비공개 `/readyz`를 identity token과 함께 호출해 둘 다 `database=ready`, `gcs_assets=real`인지 확인한다. 명령은 `infra/README.md`의 readiness 절차를 사용한다.
4. 면제 경로가 아닌 동일 GET을 대조한다. `curl -fsS 'https://api.essesion.shop/products?limit=1'`은 200, `curl -sS -o /dev/null -w '%{http_code}' "$(tofu -chdir=infra output -raw api_url)/products?limit=1"`은 403이어야 한다. `/healthz`와 Google OIDC를 별도로 검증하는 `/batch/*`만 전역 edge 검사의 예외다.
5. 배치 확인: `tofu -chdir=infra output -raw api_url`이 scheduler audience 형식(`https://api-<project#>.<region>.run.app`)과 일치하는지 대조 → `gcloud scheduler jobs run batch-cancel-stale-orders --location asia-northeast3` → api 로그 200 확인.
6. 초기 관리자와 모티프 입력 (로컬에서 스테이징 DB로 — cloud-sql-proxy 등으로 `DATABASE_URL` 지정):
   ```bash
   printf 'Admin email: '
   read -r BOOTSTRAP_ADMIN_EMAIL
   printf 'Admin password (12+ chars): '
   read -rs BOOTSTRAP_ADMIN_PASSWORD
   printf '\n'
   export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   uv run python apps/api/scripts/bootstrap_admin.py create
   unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
   uv run python apps/worker/scripts/seed_motifs.py
   uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live
   ```
   인덱싱 출력이 `embedded=<total>/<total>`인지 확인한다. `GCP_PROJECT_ID`/ADC 또는 확인 플래그가 없으면 실행되지 않으며 `user_upload`은 대상이 아니다. `apps/api/scripts/seed.py`는 local/test 전용이다. `create`는 이미 admin 계정이 있으면 실패한다. 유출·분실 시 같은 환경 변수 방식으로 `reset-password`, 비밀번호 변경 없이 강제 로그아웃할 때 이메일만 지정해 `revoke-sessions`를 실행한다. 두 명령은 admin refresh session만 폐기한다.
7. 외부 콘솔은 프록시 검증 후 처음부터 공개 API 도메인만 등록한다. Cloud Run URL은 등록하지 않는다.
   - **Toss** 대시보드: 웹훅 URL → `https://api.essesion.shop/payments/webhook`, successUrl 콜백 경로 갱신
   - **Google·Kakao** 콘솔: redirect URI → `https://api.essesion.shop/auth/{provider}/callback`
   - Solapi 발신번호·PF ID·승인된 템플릿 3종은 `staging.tfvars`의 `api_extra_env`로 (`SOLAPI_SENDER_NUMBER`, `SOLAPI_PF_ID`, `SOLAPI_TEMPLATE_CLAIM_DONE`, `SOLAPI_TEMPLATE_CLAIM_REJECTED`, `SOLAPI_TEMPLATE_QUOTE_RECEIVED`)

## C. Cloudflare 프론트 route 확인 (5단계 프론트 배포 시점)

- A5에서 zone·`api.essesion.shop`·WAF는 이미 개통돼 있어야 한다. `app.essesion.shop`과 `admin.essesion.shop` custom-domain route는 각 `wrangler.jsonc`에 고정되어 있으므로 배포 결과에서 연결을 확인한다. 도메인을 바꿀 때는 대시보드에서 임시 수정하지 말고 설정 파일과 origin/CORS 값을 같은 변경으로 갱신한다.
- A2에서 확정한 frontend/admin origin과 `VITE_API_BASE_URL=https://api.essesion.shop`을 유지한 채 store/admin workers를 배포한다.
- `curl -I https://admin.essesion.shop/login`으로 `Content-Security-Policy`의 `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`를 확인하고, B4의 공개 `/products` 200·Cloud Run 직통 403 대조를 다시 실행한다.
- api `min-instances=1` 상향은 프로덕션 전환 시 `api_min_instances` 변수로 적용한다.

## D. Admin 스테이징 운영 확인 (로컬 출시 판정 완료 후)

Admin A~J와 Playwright smoke는 2026-07-12 로컬 출시 검증으로 완료됐다. 아래 1~3은 완료 증거이며, 4~7은 GCP·Cloudflare 개통 뒤 실제 외부 capability와 운영 절차를 확인하는 스테이징 게이트다. 이 게이트는 admin 구현 완료를 다시 열지 않고 별도 배포·리허설 항목을 닫는다.

1. **완료** — 마지막 API 변경을 포함한 `pnpm codegen` 생성물 drift 0과 전체 Python/JS lint·typecheck·test gate를 통과했다. 최신 수치는 `docs/reviews/repo-refactor-2026-07.md`의 최종 검증 결과를 정본으로 삼는다.
2. **완료** — 실제 API와 PostgreSQL seed로 `e2e/admin-smoke.spec.ts`를 실행해 관리자 로그인 → 보호 목록/상세 → 대표 상태 변경 → 로그아웃을 확인했다.
3. **완료** — Aside 하네스로 1440/390/767/768/1024px와 200% zoom에서 주문·클레임 mutation, 상품 편집, 안전한 SVG, 모바일 메뉴·table scroll·dialog focus 복귀·reduced motion·탭 간 logout을 확인했다.
4. 공개 `https://api.essesion.shop/readyz`와 admin 대시보드에서 `gcs`(비공개 업로드/read), `gcs_assets`(공개 상품·생성 결과), `finalize_tasks`(Cloud Tasks 전달)가 각각 `real`, `batch_auth`가 `oidc`, `edge_proxy`가 `ready`인지 확인한다. 하나라도 `unavailable`이면 관련 mutation을 진행하지 않는다.
5. 관리자 role 변경·비활성화·비밀번호 유출 대응에는 `bootstrap_admin.py revoke-sessions` 또는 `reset-password`를 사용한다. 모든 access token은 발급 시 role/current role 일치를 요구하고 admin token은 `session_kind=admin`도 요구하므로 역할 변경 직후 기존 access 요청은 401이며, refresh session도 별도로 폐기한다.
6. Toss confirm/refund가 timeout·5xx로 끝나면 같은 요청을 수동 재시도하지 않는다. open payment incident를 `/incidents`에서 확인하고 서버가 보관한 정확한 lookup key로 Toss를 재조회한다(API 응답의 key는 redacted). `amount_mismatch`는 같은 payment/group의 provider 상태가 `CANCELED`일 때만 내부 주문 취소·쿠폰 복원·토큰 회수로 종결한다. 과거 key와 현재 주문 key가 다르면 open으로 남기며 강제 해결하지 않는다. `mixed_state`도 내부 상태와 provider 상태가 이미 일치한 뒤 재대사해야 닫히고, 메모만으로는 해결할 수 없다. `partial_cancel`만 최신 provider 증거·금액 검증·관리자 메모를 모두 갖춘 예외적 수동 해결 대상으로 둔다.
7. 상품·주문·견적·리폼 업로드는 API가 돌려준 `x-goog-if-generation-match: 0` header를 포함해 한 번만 PUT하고, custom/sample 주문 참고 이미지는 완료된 `upload_id`만 주문 body에 전달하는 smoke를 포함한다.

## E. 스테이징 리허설

1. 빈 스테이징 DB에 Alembic migrate job이 `dadd999bf858` 단일 베이스라인을 적용했는지
   확인한다. 이전 개발 revision이 발견되면 데이터 변환을 시도하지 말고 DB를 재생성한다.
2. 실제 Toss sandbox, Google/Kakao OAuth, Solapi, generate → finalize Cloud Tasks 흐름과
   주문·클레임 E2E를 실행한다. Apple/Naver는 구현·등록 전까지 완료로 판정하지 않는다.
3. 상품 이미지 업로드와 finalize 메모리·지연을 실측해 dpi·인스턴스 상한을 확정한다.
4. **production 차단 게이트**: 회원 탈퇴 뒤에도 주문 snapshot, 주문 item/claim/refund JSON,
   견적·문의·수선 배송 정보, 이미지·디자인 prompt/job payload, 관리자 로그에 역사성
   개인정보가 남는다. 사용자 FK가 없는 seamless 생성 로그·전역 motif·공개 preview는
   현재 사용자별 회수도 불가능하다. 필드별 보존 목적·기간·접근 통제·분리 저장·만료 시 익명화/삭제
   배치를 privacy owner와 법률 검토자가 승인하고, 샘플 데이터로 purge/anonymization과
   복구 불가성을 검증하기 전에는 컷오버하지 않는다.

## F. 프로덕션 컷오버

1. production 전용 GCP project/tfstate/tfvars와 별도 시크릿을 만들고 OpenTofu plan을
   2인 검토한다. staging 시크릿을 복사하지 않는다.
2. provider redirect URI와 Toss webhook을 공개 production API 도메인으로 등록하고,
   E의 전체 readiness·E2E·개인정보 게이트를 다시 통과한다.
3. 쓰기 동결 → 최종 데이터 이관·매핑 검증 → DNS 전환 → 전원 재로그인 공지를 순서대로
   수행한다. DNS 원복과 동결 유지 조건을 포함한 rollback runbook을 먼저 승인한다.
4. 안정화 지표와 데이터 대조가 끝난 뒤에만 Supabase 프로젝트를 해지한다.

## 완료 시 CHECKLIST 갱신

A~B가 끝나면 CHECKLIST의 OpenTofu·예산/uptime·Sentry·Secret Manager·worker 배포와
Alembic 스테이징 적용 항목을 갱신한다. C가 끝나면 Cloudflare Workers 배포를 갱신한다.
D의 운영 확인과 E·F는 각각 스테이징 리허설·컷오버 증거를 첨부한 뒤에만 체크한다.
5단계의 `admin 재작성`과 `Playwright admin 스모크`는 로컬 출시 검증으로 이미 완료됐다.
