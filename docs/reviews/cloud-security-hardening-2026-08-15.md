# Production 클라우드 보안 하드닝 1차 적용 결과

2026-08-15 `ysindustry`와 `essesion.shop`의 Cloud Run·Cloud SQL·IAM·GCS·Artifact Registry·
Cloudflare 경계를 점검하고, 서비스 중단 없이 확인된 갭을 보강했다.

## 적용 결과

### Cloudflare

- Minimum TLS를 1.2로 고정했다. 실제 요청에서 TLS 1.0/1.1은 거부되고 1.2/1.3은 성공한다.
- SSL origin mode를 Full에서 Full (Strict)로 바꿨다.
- HSTS를 `max-age=2592000`, includeSubDomains OFF, preload OFF로 시작했고 No-Sniff를 켰다.
- DNSSEC는 카페24가 DS 등록을 지원하지 않아 해제했다. 공개 DNS에 DS 위임이 없고 HTTPS는 정상이다.
- Bot Fight Mode는 CI와 Toss webhook을 막았던 기존 결정대로 OFF를 유지했다.
- 사용 기록이 오래된 광범위 build token 두 개를 삭제했다. 현재 Agent token과 1개 zone에 한정된
  Workers 배포 token은 실제 사용 중이어서 유지했다. token 값은 열람하거나 기록하지 않았다.
- 계정 MFA는 비활성 상태로 확인됐다. 보안 키 등록은 계정 소유자 조작이 필요해 후속 작업으로
  남겼다.

### GCP IAM과 API key

- 기본 Compute SA의 프로젝트 `roles/editor`를 제거했다.
- Firebase Admin SDK SA의 프로젝트 `roles/iam.serviceAccountTokenCreator`와
  `roles/firebase.sdkAdminServiceAgent`를 제거했다.
- 두 레거시 SA를 삭제했다. 삭제 전 권한·사용 기록이 없음을 확인했다.
- 30일 Service Runtime metrics에서 사용이 없고 저장소 소비자도 없는 무제한 Firebase Browser
  API key를 삭제했다.
- 실제 Generative Language API 호출이 확인된 Gemini key는 해당 API 제한을 유지한 채 보존했다.
- 프로젝트의 모든 서비스 계정에서 사용자 관리 key가 0개임을 재확인했다.

### Cloud SQL과 GCS

- Cloud SQL connector enforcement를 `REQUIRED`, SSL mode를 `ENCRYPTED_ONLY`로 강제했다.
- 인스턴스 설정과 API 양쪽 deletion protection을 켰다.
- public IPv4는 Cloud Run connector 구조상 유지하되 authorized network는 계속 0개다.
- uploads와 tfstate 버킷을 uniform access + Public Access Prevention `enforced`로 고정했다.
- 두 private 버킷의 projectViewer/projectEditor legacy convenience binding을 제거했다.
- assets 공개 읽기와 api 공개 invoke는 서비스 설계상 유지했다.

### 감사·알림·이미지 분석

- Secret Manager `DATA_READ`, IAM token/impersonation `DATA_READ`, Storage
  `DATA_READ`·`DATA_WRITE` Audit Log를 선언했다.
- IAM policy, SA key, GCS 보안 설정, Cloud SQL 보안 설정 변경을 기존 이메일 채널로 알리는 정책을
  추가했다.
- Container Scanning API를 활성화했다. 기존 이미지는 결과가 없으므로 다음 신규 배포 digest부터
  확인한다.

## 실제 검증

- OpenTofu validate 통과 및 apply 후 재계획 `No changes`.
- `https://api.essesion.shop/readyz` 200, DB·GCS·OAuth·batch capability 정상.
- Cloudflare proxy `/products` 200, run.app 직통 `/products` 403.
- `run-api` OIDC로 두 private worker `/readyz` 200.
- Cloud SQL: connector `REQUIRED`, deletion protection true, SSL `ENCRYPTED_ONLY`, backup/PITR true.
- uploads 익명 접근 403, uploads·tfstate Public Access Prevention `enforced`.
- 공개 IAM은 api `allUsers/run.invoker`와 assets `allUsers/objectViewer`뿐이다.
- HSTS와 `X-Content-Type-Options: nosniff` 응답 헤더를 확인했다.
- Cloudflare 설정 변경 뒤 root·app·admin·api가 모두 200을 유지했다.

## 남은 위험

- Cloudflare와 GCP Owner의 phishing-resistant MFA는 계정 소유자가 완료해야 한다.
- DNSSEC는 현재 비활성이다. 필요 시 DS 등록을 지원하는 등록기관으로 이전한 뒤 다시 활성화한다.
- disable한 레거시 SA는 관찰 기간이 끝날 때까지 존재한다.
- Cloudflare Agent token은 현재 연결에 사용 중인 광범위 token이다. 연결 방식을 바꿀 때
  계정·zone·만료 범위를 더 줄여 회전한다.
- Artifact Analysis는 다음 신규 이미지가 배포돼야 실제 취약점 결과를 만든다.
