# essesion.com 이전 — 준비·동시 운영 단계 결과 (2026-11-12)

`docs/plans/domain-move-essesion-com.md`의 A(준비)·B(동시 운영)를 실행했다. 남은 단계(토스 변경 신청·전환·
정리)는 플랜에 있다. 알림톡 템플릿 작업은 `alimtalk-com-migration-2026-11-12.md`에 따로 기록했다.

## 한 일

- **도메인**: Cloudflare Registrar에서 `essesion.com` 등록. `essesion.shop`은 카페24 등록·2026-12-12 만료이고
  연장하지 않기로 했다(연장비 약 7만 원, `.com`은 연 1만 원 안팎).
- **새 존 설정**: 구 존의 값을 읽어 같은 값으로 넣었다 — SSL `strict`, Always Use HTTPS, 최소 TLS 1.2,
  HSTS 30일(includeSubDomains·preload 꺼짐), 봇 설정(AI 봇 차단 등). `www.essesion.com` → 루트 301.
  Image Transformations를 켜고 소스를 Specified origins로 두어 `essesion.com`·`assets.essesion.shop`·
  `assets.essesion.com`을 허용했다.
- **메일**: iCloud+ 커스텀 이메일 도메인용 레코드(MX 2, SPF, `apple-domain` TXT, DKIM CNAME — DNS only)가
  들어가 있고, `_dmarc`에 `v=DMARC1; p=none`을 추가했다. Email Routing은 켜지 않았다.
- **동시 운영 코드(#110)**: api-proxy가 접속 호스트를 `X-Essesion-Forwarded-Host`로 넘기고, api는
  `ALT_SITE_ORIGINS` 허용 쌍에서 OAuth `redirect_uri`·복귀 프론트 주소를 고른다. 스토어는 `essesion.com`으로
  접속하면 `api.essesion.com`을 부른다. 스토어·api-proxy에 `.com` 커스텀 도메인 추가. 명세는
  `docs/api-spec/domains.md` 소셜 콜백 계약.
- **운영 값**: `ALT_SITE_ORIGINS = {"https://api.essesion.com": "https://essesion.com"}`, `CORS_ORIGINS`와 업로드
  CORS에 `https://essesion.com` 추가. 코드 배포보다 **먼저** apply했다 — 운영 중인 api는 모르는 환경값을
  무시하므로 해가 없고, 순서를 바꾸면 `.com` 화면이 api를 부르지 못한다(CodeRabbit 지적).
- **소셜 로그인 콘솔**: 카카오(플랫폼 키 > REST API 키 > 리다이렉트 URI)·구글·네이버(Callback URL만)·
  애플(Services ID의 Website URLs)에 `api.essesion.com` 콜백을 추가했다. 기존 `.shop` 값은 유지.
- **전환 준비**: 구 존에 Single Redirect 4개를 비활성 상태로 만들었다(302, 쿼리 보존). 전환 PR #112(초안).
  새 이미지 호스트 선개통 #111.

## 확인한 것

- 한 Worker가 서로 다른 두 존의 커스텀 도메인을 동시에 가질 수 있다(스토어·api-proxy 모두 배포 성공) —
  플랜에서 "추정"이던 항목.
- `api.essesion.com/auth/kakao/login`의 `redirect_uri`는 `api.essesion.com`, `api.essesion.shop`으로 들어오면
  `api.essesion.shop`. 두 주소 모두 자기 출처에 CORS를 허용한다.
- `.com`에서 소셜 로그인 4종 동작(운영자 브라우저 확인), 이미지 변환 200(`/cdn-cgi/image`).
- CI의 api 통합 테스트 통과(허용 쌍·목록 밖 호스트 → 기본 쌍).

## 플랜과 달랐던 점

- **WAF 커스텀·레이트리밋 규칙은 복사할 것이 없었다.** 구 존에 사용자 규칙이 없다(관리 규칙만). DNSSEC도
  구 존이 꺼져 있어 같게 뒀다.
- **구 존에는 이미 `www` → 루트 301 규칙이 있다.** 전환 때 `www.essesion.shop` → `.com` 규칙을 켜면서 이
  규칙은 끈다.
- **상품 이미지 주소가 DB에 절대 URL로 저장돼 있다**(`admin/products.py`의 `public_asset_url`). `.shop` 만료
  전에 갱신해야 해서 #112에 데이터 마이그레이션을 넣었다.
- **배포에서 DB 마이그레이션이 Cloudflare 배포보다 먼저 실행된다.** 전환 PR 하나에 넣으면 DB가 아직 없는
  이미지 호스트를 가리키는 구간이 생겨, 새 호스트·CSP 허용을 #111로 먼저 분리했다.
- **네이버 서비스 URL은 전환하는 날 바꾸기로 했다**(플랜은 토스 신청과 함께였다).
- **클레임 완료·거부 알림**은 새 템플릿 승인 전까지 "새 코드(변수 2개) + 기존 템플릿(1개/0개)" 상태다.
  클레임 이력이 없어 감수했다.
- 로컬 `production.tfvars`가 버킷 최신본보다 오래돼 있었다(네이버 클라이언트 ID가 자리표시자). 수정 전에
  반드시 버킷에서 받는다.
- tofu의 기본 자격 증명(ADC)이 다른 Google 계정이었다. `GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth
  print-access-token)`으로 gcloud 로그인 계정을 쓰게 했다.

## 남은 확인

- **메일 DKIM 정렬**: 대표 주소에서 Gmail로 보내 "원본 보기"에 `dkim=pass header.d=essesion.com`과
  `dmarc=pass`가 나오는지. 확인 전에는 DMARC를 `p=none`에서 올리지 않는다.
- **자동 발송 가능 여부**: 앱 암호로 `smtp.mail.me.com:587`에 접속해 보내는 사람을 `@essesion.com`으로 한 통
  발송. Apple 문서는 커스텀 주소 발신을 언급하지 않는다.
- **사이트 연락처 교체**: `apps/store/src/app/layout/app-layout.tsx:241`,
  `apps/store/src/pages/privacy-policy/index.tsx:144`의 개인 메일을 새 주소로.
- **알림톡 새 템플릿 8종 검수 요청**, Search Console·서치어드바이저·PostHog에 `essesion.com` 등록.
- 구글 OAuth 클라이언트의 예전 보안 비밀(`****eYH1`)은 운영에서 쓰지 않는다(Secret Manager의 값은
  `****-OT2`). 로컬 `.env` 확인 뒤 사용 중지·삭제.
- 임시 Cloudflare API 토큰(`domain-move-temp`, 7일 만료)은 전환 뒤 폐기.
