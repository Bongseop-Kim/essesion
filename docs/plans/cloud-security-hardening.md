# Production 클라우드 보안 하드닝

2026-08-15 읽기 전용 점검에서 확인한 실제 갭을 닫는다. 대상은 GCP 프로젝트 `ysindustry`의
Cloud Run·Cloud SQL·IAM·GCS·Artifact Registry·감사 로그와 Cloudflare zone
`essesion.shop`이다. 별도 staging이 없으므로 변경군을 섞지 않고, 각 단계 뒤 production
readiness를 확인한 다음 진행한다.

관련 정본:

- `ARCHITECTURE.md` §1·§2 — 공개 경계와 런타임 구성
- `infra/README.md` — production 개통·검증 절차
- `docs/reviews/cloudflare-waf-rate-limits-2026-08-14.md` — edge WAF·레이트리밋을 두지 않는 결정
- `docs/reviews/cloudflare-bot-challenge-2026-08-14.md` — Bot Fight Mode를 OFF로 유지하는 이유

## 점검 기준선

아래는 플랜 작성 시점의 live 상태다. 실행 직전에 같은 명령으로 다시 확인하고 달라졌으면 이
문서를 먼저 갱신한다.

### 정상 — 유지할 것

- 공개 IAM은 `api`의 `allUsers/run.invoker`와 `ysindustry-assets`의 공개 읽기뿐이다.
- `worker-generate`·`worker-finalize`는 익명 접근이 막히고, `run-api` OIDC로 `/readyz` 200이다.
- Cloudflare 경유 `/readyz` 200, run.app 직통 일반 API와 가짜 edge secret은 403이다.
- Scheduler는 전용 SA의 OIDC audience·email을 검증하고, GitHub 배포는 키 없는 WIF를 쓴다.
- 사용자 관리 서비스 계정 키는 0개다.
- Cloud Run의 민감 환경 변수는 모두 Secret Manager 참조이며 secret별 IAM으로 제한돼 있다.
- Cloud SQL authorized network는 없고 Cloud Run 내장 Auth Proxy로 접속한다. 백업 7개와 PITR가
  켜져 있다.
- `ysindustry-uploads`는 비공개, `ysindustry-assets`만 의도적으로 공개다.
- TLS 1.0/1.1은 거부하고 1.2/1.3만 허용한다. CSP·Origin·CORS 검증도 정상이다.

### 닫을 갭

1. 미사용으로 보이는 `firebase-adminsdk-fbsvc`가 프로젝트 전체
   `roles/iam.serviceAccountTokenCreator`를 갖고 있다.
2. 기본 Compute SA가 `roles/editor`를 갖고 있다. 둘 다 사용자 관리 키와 최근 30일 활동은
   없고, VM·Functions·Firestore·App Engine 서비스도 없다.
3. Gemini API key와 Firebase Browser key가 남아 있다. Browser key는 referrer 제한이 없고,
   저장소에는 Firebase/Gemini 소비자가 없다.
4. Cloud SQL은 public IP + connector 경로지만 `connectorEnforcement=NOT_REQUIRED`,
   `sslMode=ALLOW_UNENCRYPTED_AND_ENCRYPTED`, API 수준 삭제 방지 OFF다.
5. private uploads 버킷의 Public Access Prevention이 `inherited`다. 프로젝트는 organization에
   속하지 않아 상위 강제가 없다.
6. Data Access audit config와 보안 변경 알림이 없고 uptime 알림만 있다.
7. Artifact Registry 자동 취약점 스캔이 꺼져 있다.
8. Cloudflare HSTS와 DNSSEC이 꺼져 있다. 대시보드의 MFA·API token scope는 로컬 wrangler
   미인증과 Aside daemon 미실행으로 확인하지 못했다.

## 범위 밖

- Cloud Armor·외부 Load Balancer·VPC/Private IP 전환은 하지 않는다. 현재 public IP + Cloud SQL
  connector와 Cloudflare edge-secret 경계가 실제로 동작하며, 이들을 추가하면 운영 면적만 는다.
- Cloudflare WAF·Rate Limiting·Bot Fight Mode를 다시 켜지 않는다. 기존 앱 리미터와 Free
  Managed Ruleset을 유지하고, BFM은 server-to-server 웹훅을 막으므로 OFF가 정본이다.
- Binary Authorization은 이번에 넣지 않는다. 먼저 자동 이미지 스캔을 켜고, 서명·승인형 배포가
  실제 요구가 될 때 별도 제안한다.
- assets 버킷의 공개 읽기는 제거하지 않는다.
- CAA와 HSTS preload는 넣지 않는다. 둘 다 인증서 운영을 잘못 고정했을 때 복구 비용이 현재
  이익보다 크다.

## 실행 순서

### 1. Cloudflare 계정 내부 상태 확인

변경 전 Aside Browser를 실행하거나 `wrangler login`을 완료해 다음을 읽기 전용으로 기록한다.

- zone plan과 SSL mode, Always Use HTTPS, minimum TLS, HSTS, DNSSEC
- Bot Fight Mode가 OFF인지와 Free Managed Ruleset 상태
- `CLOUDFLARE_API_TOKEN`의 권한이 해당 계정·Workers 배포에만 한정됐는지
- 사용자 계정 MFA가 켜졌는지
- Worker custom domain이 store(root·app), admin, api에만 붙어 있는지

Cloudflare token이 계정 전체 관리자라면 새 최소 권한 token을 만들고 GitHub secret을 교체한 뒤
기존 token을 폐기한다. 값은 출력하거나 문서에 기록하지 않는다.

수용 기준:

- `api.essesion.shop`의 BFM은 OFF, API 프록시 경로는 유지된다.
- token scope와 MFA 상태만 `docs/reviews/` 결과 문서에 기록하고 식별자·값은 남기지 않는다.

### 2. 레거시 IAM·API key 제거

파괴 작업 전 아래를 다시 확인한다.

```bash
gcloud compute instances list --project=ysindustry
gcloud functions list --project=ysindustry
gcloud firestore databases list --project=ysindustry
gcloud logging read \
  'protoPayload.authenticationInfo.principalEmail=("801310318969-compute@developer.gserviceaccount.com" OR "firebase-adminsdk-fbsvc@ysindustry.iam.gserviceaccount.com")' \
  --project=ysindustry --freshness=30d --limit=20
```

활동이 계속 0이면 다음 순서로 정리한다.

1. `firebase-adminsdk-fbsvc`의 프로젝트 `roles/iam.serviceAccountTokenCreator`를 제거한다.
2. 기본 Compute SA의 프로젝트 `roles/editor`를 제거한다.
3. 두 SA를 먼저 disable하고 7일 관찰한다. 오류·숨은 소비자가 없으면 삭제한다.
4. Gemini API key와 Firebase Browser key의 실제 호출자가 없음을 API metrics로 확인한 뒤
   삭제한다.
5. `infra/main.tf`의 `aiplatform.googleapis.com`을 포함해 Firebase/Gemini 잔재 API를 목록화하고,
   현재 리소스와 다른 enabled API의 dependency가 없는 항목만 제거한다. 자동으로 활성화된 내부
   API를 한꺼번에 끄지 않는다.

기존에 OpenTofu가 소유하지 않은 레거시 객체를 억지로 import하지 않는다. 일회성 삭제 명령과
검증 결과만 review에 남긴다.

수용 기준:

- 프로젝트 IAM에 `roles/editor`가 없고, project-level Token Creator는 의도된 주체가 없다.
- 사용자 관리 SA key는 계속 0개다.
- 현재 Cloud Run SA·WIF·Scheduler·Tasks IAM에는 diff가 없다.
- 공개 API와 worker OIDC readiness가 그대로 통과한다.

### 3. Cloud SQL connector·삭제 방지 강제

`infra/cloudsql.tf`의 기존 `google_sql_database_instance.main`에 다음만 추가한다.

- connector enforcement `REQUIRED`
- SSL mode `ENCRYPTED_ONLY`
- GCP API 수준 deletion protection enabled

public IPv4와 authorized network 0건은 유지한다. Cloud Run volume의 내장 Auth Proxy는 암호화와
상호 신원 검증을 하므로 private IP/VPC를 추가하지 않는다.

절차:

1. provider schema에서 위 세 필드명을 확인한다.
2. `tofu -chdir=infra plan -var-file=production.tfvars`가 SQL 설정 세 항목 외 변경을 만들지
   확인한다.
3. apply 후 API `/readyz`와 두 worker의 OIDC `/readyz`를 즉시 확인한다.
4. `gcloud sql instances describe essesion-pg`로 connector·SSL·삭제 방지 값을 재확인한다.

DB 연결이 깨지면 connector enforcement만 즉시 되돌린다. SSL 강제는 connector 경로와 호환돼야
하므로, 여기서 실패하면 예상하지 못한 direct client가 있다는 뜻이다. 그 client를 먼저 찾아
connector로 옮긴다.

### 4. private GCS 경계 고정

`infra/main.tf`의 `google_storage_bucket.uploads`에 bucket-level Public Access Prevention
`enforced`를 추가한다. Signed URL은 이 설정의 영향을 받지 않는다.

OpenTofu 밖의 `essesion-tfstate`는 이미 `enforced`이므로 설정을 바꾸지 않는다. 대신 tfstate와
uploads IAM의 `projectViewer`·`projectEditor` legacy convenience binding을 제거한다. 프로젝트
Owner와 명시적 runtime SA 권한은 유지하고 assets 버킷은 건드리지 않는다.

수용 기준:

- uploads와 tfstate가 모두 uniform access + Public Access Prevention `enforced`다.
- uploads에는 `run-api`의 `roles/storage.objectAdmin` 외 object 접근자가 없다.
- 익명 uploads 객체 읽기는 401/403이고, 애플리케이션의 signed upload/download smoke는 성공한다.
- assets의 익명 공개 읽기는 계속 성공한다.

### 5. 최소 감사 로그·보안 알림 추가

먼저 현재 로그량을 24시간 기준으로 확인한 뒤 `infra/`에 필요한 것만 선언한다.

- Secret Manager `DATA_READ`
- IAM Credentials의 impersonation/token 생성 Data Access 로그
- Storage `DATA_READ`·`DATA_WRITE` — public `allUsers` 요청은 Data Access 로그 대상이 아니므로
  private uploads와 운영자 접근량을 기준으로 비용을 확인한다.

기존 notification channel을 재사용해 하나의 보안 변경 log-based metric과 alert policy를 만든다.
필터는 다음 admin event만 포함한다.

- 프로젝트·서비스 계정 IAM policy 변경
- 사용자 관리 서비스 계정 key 생성·업로드
- GCS IAM/public access 설정 변경
- Cloud SQL 네트워크·SSL·삭제 방지 설정 변경

Secret 값 접근은 우선 로그만 남기고 호출마다 알림을 보내지 않는다. 정상 Cloud Run 기동과 회전도
access를 만들 수 있어 경보 피로가 더 크다.

수용 기준:

- 프로젝트 IAM policy에 의도한 `auditConfigs`만 존재한다.
- alert policy가 enabled이고 기존 이메일 notification channel에 연결돼 있다.
- 기존 uptime alert와 `_Required`·`_Default` sink를 덮어쓰지 않는다.

### 6. Artifact Registry 자동 스캔 활성화

`infra/main.tf`의 API 목록에 Artifact Analysis 자동 스캔에 필요한 API만 추가한다. 별도 scanner,
CI action, SBOM 저장소는 만들지 않는다.

수용 기준:

- `essesion` repository의 `vulnerabilityScanningConfig.enablementState`가 enabled다.
- 새 이미지 한 번을 정상 배포한 뒤 api·worker digest에 scan result가 생성된다.
- CRITICAL/HIGH finding을 review에 기록하되 이 플랜 안에서 무관한 dependency 업그레이드까지
  확장하지 않는다. 배포 차단은 아직 걸지 않는다.

### 7. Cloudflare HSTS·DNSSEC 활성화

모든 현재 host(root·www·app·admin·api)가 HTTP→HTTPS 301이고 HTTPS가 정상인 것을 다시 확인한
뒤 진행한다.

1. HSTS를 짧은 max-age로 먼저 켠다. 첫 단계에는 `preload`를 끄고, 모든 subdomain이 HTTPS임을
   확인한 경우에만 `includeSubDomains`를 켠다.
2. 한 주 동안 인증서·redirect 문제가 없으면 max-age를 6개월로 올린다.
3. Cloudflare DNSSEC를 켜고 registrar에 DS가 반영될 때까지 확인한다. DS 등록 실패 상태로 오래
   방치하지 않는다.

수용 기준:

```bash
curl -sSI https://essesion.shop | grep -i '^strict-transport-security:'
dig +short DS essesion.shop
```

- root·app·admin·api가 TLS 1.2/1.3에서 정상이고 기존 CSP 헤더를 유지한다.
- 공개 `/readyz` 200, `/products` 200, run.app 직통 `/products` 403을 다시 확인한다.
- GitHub deploy의 public proxy/direct-origin 검증이 성공한다.

### 8. 독립 production 계정 보호 확인

이 프로젝트는 organization에 속하지 않아 organization policy로 SA key 생성·업로드를 막을 수
없다. 지금 당장 organization을 새로 만들지는 않는다. 대신 다음을 운영 기준으로 남긴다.

- GCP Owner와 Cloudflare 계정에 phishing-resistant MFA를 사용한다.
- 분기마다 사용자 관리 SA key 0건과 IAM 고권한 binding을 확인한다.
- 운영자가 둘 이상이 되거나 외부 CI가 추가되면 Cloud Identity/Workspace organization 편입과
  `iam.disableServiceAccountKeyCreation`·`iam.disableServiceAccountKeyUpload` 강제를 별도
  제안한다.

로컬 `gcloud` 기본 프로젝트도 `ysindustry`로 고정하거나 모든 운영 명령에 `--project=ysindustry`를
계속 명시한다.

## 최종 검증

```bash
tofu -chdir=infra plan -var-file=production.tfvars
pnpm architecture:check
gcloud projects get-iam-policy ysindustry
gcloud iam service-accounts keys list --iam-account=<각-runtime-SA> --managed-by=user
gcloud sql instances describe essesion-pg --project=ysindustry
gcloud storage buckets describe gs://ysindustry-uploads --project=ysindustry
gcloud artifacts repositories describe essesion --location=asia-northeast3 --project=ysindustry
curl -fsS https://api.essesion.shop/readyz
curl -sS -o /dev/null -w '%{http_code}\n' \
  https://api-ryessxc2ba-du.a.run.app/products?limit=1
```

추가로 두 worker는 `infra/README.md`의 SA impersonation 절차로 `/readyz` 200을 확인한다. 전체
결과에서 다음을 만족해야 한다.

- OpenTofu no-change
- public proxy 200 / direct origin 403 / private worker OIDC 200
- DB·GCS·batch·OAuth capability 전부 `ready`·`real`·`oidc`
- 사용자 관리 SA key 0개, 의도하지 않은 `allUsers` 0개
- Cloudflare HSTS·DNSSEC 활성
- GitHub deploy workflow 성공

## 완료 처리

실행 결과와 실제 변경값, 되돌린 항목, 남긴 위험을
`docs/reviews/cloud-security-hardening-<날짜>.md`에 기록한다. 완료 후 이 파일은
`docs/plans/`에서 삭제한다.
