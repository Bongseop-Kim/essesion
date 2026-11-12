# essesion.shop → essesion.com 이전 + iCloud+ 커스텀 도메인 메일

정본 도메인을 `essesion.shop`에서 `essesion.com`으로 옮기고, 사업용 메일 주소(`<주소>@essesion.com`)를
이미 구독 중인 iCloud+ 커스텀 이메일 도메인으로 만든다. 도메인·DNS·SSL은 지금처럼 Cloudflare(Free)에 둔다.
2026-11-11 조사, 2026-11-12 운영자 결정 기준으로 작성했다.

방식은 **동시 운영 후 전환**이다. `.com`을 먼저 띄워 `.shop`과 함께 운영하고(서버를 더 띄우는 것이 아니라
같은 스토어·api에 주소를 하나 더 붙인다), `.com`에서 로그인 등을 확인한 뒤 토스·네이버에 주소 변경을
신청하고, 승인 직후 `.com` 결제를 확인한 다음에 `.shop`을 `.com`으로 보낸다. 그동안 `.shop`은 평소대로
영업한다. 단계마다 날짜를 정하지는 않는다 — 앞 단계의 확인이 끝나야 다음으로 가되, 아래 기한은 넘기지 않는다.

**기한이 있다.** `essesion.shop`은 2026-12-12에 만료되고 연장하지 않는다(2026-11-12 운영자 결정). 그날부터
`.shop`의 모든 주소(사이트·api·assets·리다이렉트)가 사라지므로, 그 전에 `.shop`에 기대는 것이 하나도 남지
않아야 한다. 역산한 일정:

| 기한 | 단계 |
|---|---|
| 가능한 한 빨리 | A → B → C — 준비, 동시 운영 배포와 `.com` 실측(결제 제외), 토스·네이버 변경 신청 |
| 승인 직후 | D 전환 — 토스·네이버 승인(문의 답변 기준 약 하루)이 난 뒤 |
| **2026-11-27** | **D 전환의 마지막 날** — 이날까지 301 전환이 끝나야 E의 14일을 채운다 |
| 2026-12-11 | E 완료 — `.shop`에 기대는 것 전부 제거 |
| 2026-12-12 | `.shop` 만료 |

이 플랜의 실패 모드는 둘이다. ① 동시 운영을 위해 넣은 "접속한 도메인을 따라가는" 분기가 정리되지 않고
영구히 남는 것(E단계가 그 정리다). ② 본문에서 "미확인"·"추정"이라고 적은 외부 정책을 확인된 사실처럼
믿는 것.

## 왜 필요한가

- 사업용 연락처가 개인 네이버 메일이다(`apps/store/src/app/layout/app-layout.tsx:241`,
  `apps/store/src/pages/privacy-policy/index.tsx:144`). 1인 운영이라 월 과금 메일(Google Workspace·네이버웍스)은
  쓰지 않기로 했고, iCloud+는 이미 구독 중이라 추가 비용이 없다.
- Gmail의 타사 주소 "다른 주소에서 보내기"는 2027년 1월에 제거된다
  ([Google 공지](https://support.google.com/mail/answer/17101213?hl=en)). 전달 + Gmail 발신 방식은 쓸 수 없다.
- `.com`으로 옮기는 데 기술적 이유는 없다. 가장 일반적인 주소로 가려는 운영자 선호다(2026-11-12 운영자
  확인). 메일 주소를 새로 만드는 시점이라 도메인도 함께 정리한다.
- 유지 비용 차이가 크다. `.shop` 1년 연장은 카페24 기준 약 7만 원이고, `.com`은 Cloudflare에서 연 1만 원
  안팎이다(2026-11-12 운영자 확인). `.shop`을 연장하지 않고 만료 전에 이전을 끝내려는 이유다.
- 동시 운영을 택한 이유: 토스·네이버가 주소 변경을 처리하려면 새 주소에 사이트가 떠 있어야 하고, 등록
  주소가 맞지 않는 상태로 결제를 시험하는 순서는 돈 경로에서 받아들일 수 없다. 변경 처리 자체는 양쪽 모두
  하루 안팎이라고 답을 받았다(2026-11-12 운영자 문의).

## 범위 밖

- api에 메일 발송 기능을 넣는 일. 지금 api는 메일을 보내지 않는다(알림톡·LMS만). 자동 발송이 필요해지면
  iCloud SMTP를 쓴다 — 예상 발송량이 월 5건 안팎이라 하루 1,000통 한도
  ([Apple 102198](https://support.apple.com/en-us/102198))는 문제가 아니다(2026-11-11 운영자 확인).
  전제는 A-2의 발신 테스트 통과다.
- admin의 동시 운영. 사용자가 운영자 한 명이라 D단계에서 한 번에 옮긴다.
- `app.essesion.com`은 만들지 않는다. `app.`은 예전 컷오버 이전 주소였을 뿐이다(`apps/store/wrangler.jsonc:13`).
- URL 구조·디자인 변경. 도메인 이전과 겹치면 검색 이전 신호가 흐려진다.
- `docs/reviews/`의 과거 기록 속 `essesion.shop` 치환. 당시 사실의 기록이므로 그대로 둔다.
- 통신판매업 변경신고. 신고 당시 인터넷 도메인·전자우편주소를 기재하지 않았으므로 바뀌는 신고 사항이
  없다(2026-11-11 운영자 확인).

## 실행 조건

- **iCloud 메뉴 확인**: iPhone 설정 > [이름] > iCloud > 사용자 설정 이메일 도메인(또는
  icloud.com/icloudplus)에 항목이 보이는지. Apple은 "일부 국가 미제공"이라고만 하고 목록을 내지 않는다.
  안 보이면 A-2(메일)는 실행하지 않고 대안을 다시 정한다. 웹 이전(A-1, B~E)은 메일과 무관하게 진행할 수 있다.
- **결제 전제**: 토스 홈페이지 주소 변경이 승인되기 전에는 `.com`에서 결제가 **안 되는 것으로 본다**
  (2026-11-12 운영자 결정). 토스가 등록 주소를 검사하는지는 공개 자료로 확인되지 않았으므로 안전한 쪽으로
  가정한다. 같은 가정에서, 승인되는 순간부터는 `.shop` 결제가 안 될 수 있다 — C·D의 순서는 이 틈을
  줄이도록 짰다.
- **C단계 진입 조건**: `.com`에서 "검증" 절의 브라우저 실측이 **결제를 뺀 전 항목** 통과하고, D단계 변경이
  바로 머지할 수 있는 PR로 준비돼 있어야 토스·네이버 변경을 신청한다.
- **D단계 진입 조건**: 토스 홈페이지 주소와 네이버 서비스 URL 변경이 **완료된 것을 각 콘솔에서 확인**하고
  `.com`에서 실결제 1건이 성공한 뒤에만 `.shop`을 리다이렉트한다. 완료 전에는 실행하지 말고 기다린다.

확인해 둔 것:

- Toss 웹훅 처리의 중복 수신 안전성 — **확인 완료(2026-11-11)**: DONE·CANCELED 중복 수신 시 상태·쿠폰·
  incident 변화 없고 알림톡도 1회(`apps/api/tests/test_payments.py`의
  `test_webhook_confirm_sends_payment_done_alimtalk`, `test_webhook_cancel_restores_reserved_coupon`).
  중복 CANCELED는 `action: canceled, orders: 0`으로 ack한다.
- `essesion.com`은 2026-11-12에 Cloudflare Registrar에서 구매했다. `essesion.shop`에는 MX가 없다(2026-11-11
  확인 — 구 도메인으로 받는 메일 없음).
- `essesion.shop` 만료일은 **2026-12-12**다(카페24, 2026-11-12 확인). 연장하지 않고 그 전에 이전을 끝낸다.

아직 확인할 것(순서를 바꾸지는 않는다):

- 구 존의 HSTS 설정(2026-08 기준 max-age 30일, includeSubDomains·preload
  꺼짐 — `docs/plans/cloud-security-hardening.md` §1).
- **DB에 `assets.essesion.shop` 절대 URL이 저장돼 있다(코드로 확인, 2026-11-12).** 상품 이미지는 저장 시점에
  절대 URL로 만들어 컬럼에 넣는다(`apps/api/src/api/domains/admin/products.py:798-800`, `:876-879` —
  `public_asset_url`). 2026-08-21 이후 저장된 상품은 `assets.essesion.shop` 주소를 갖고 있고, `.shop`이
  만료되면 그 이미지는 전부 깨진다. D-6에서 갱신한다. 팝업·리뷰는 조회 시점에 URL을 만들므로
  (`apps/api/src/api/domains/popups/router.py:87`, `apps/api/src/api/domains/reviews/service.py:52`) 설정만
  바꾸면 따라온다. 그 밖에 절대 URL을 저장하는 컬럼이 있는지는 D-6 실행 때 DB에서 직접 센다.
- 토스에 물어볼 것(C단계 신청 때): 승인 시점을 어떻게 알려 주는지(문자·메일·상점관리자), 승인 시각을
  미리 정하거나 영업시간 중으로 맞출 수 있는지, 변경 전후로 신·구 주소가 함께 허용되는 기간이 있는지.

## 절차

### A. 준비 — 운영에 영향 없는 "추가"만

#### A-0. `essesion.shop` 자동 연장 확인

카페24에서 `essesion.shop`의 자동 연장이 꺼져 있는지 확인한다. 연장하지 않기로 했으므로 의도치 않게
결제되지 않게 한다. 반대로 일정이 밀려 연장으로 돌아설 때(되돌리는 법 참조)는 여기서 수동 연장한다.

#### A-1. 도메인 등록과 새 존

"존"은 Cloudflare 대시보드에서 도메인 하나의 설정 묶음이다. `essesion.com`을 사면 빈 존이 새로 생기고,
`essesion.shop` 존에 해 둔 보안·SSL 설정은 따라오지 않는다. 아래 2~4번은 대시보드에서 하는 작업이다.

1. **(완료 2026-11-12)** Cloudflare Registrar에서 `essesion.com`을 신규 등록한다. 이유: 원가 판매라 국내 등록기관보다 싸고,
   DNS·Workers가 이미 Cloudflare에 있어 한곳에서 관리한다(`essesion.shop`은 카페24에서 등록했고 네임서버만
   Cloudflare다). 국내 등록기관 대비 세금계산서가 안 나오고 지원이 영어라는 점은 감수하기로 했다
   (2026-11-12 운영자 결정). 연락처는 ASCII만 허용되므로 영문으로 적는다.
   등록자 이메일은 **새 도메인과 무관한 주소**로 둔다 — 미인증이면 도메인이 hold 되는데, 새 도메인 메일을
   쓰면 메일 장애가 도메인 장애로 번진다
   ([Register a new domain](https://developers.cloudflare.com/registrar/get-started/register-domain/)).
2. 새 존에 구 존 설정을 손으로 다시 만든다. 존 설정 복제 기능은 없다. 대상: SSL/TLS 모드, Always Use
   HTTPS, HSTS(구 존과 같은 값, preload는 켜지 않는다 — preload는 브라우저 내장 목록에 올라가 되돌리는 데
   몇 달이 걸리므로 새 도메인이 안정된 뒤에 따로 판단한다), WAF 커스텀·레이트리밋 규칙
   (`docs/reviews/cloudflare-waf-rate-limits-2026-08-14.md`), Bot Fight Mode 상태
   (`docs/reviews/cloudflare-bot-challenge-2026-08-14.md` — api 호스트가 챌린지되지 않게 한 결정을 그대로),
   DNSSEC. 규칙 표현식에 `essesion.shop` 리터럴이 있으면 바꾼다.
3. 새 존에서 Image Transformations를 켜고 허용 소스에 `assets.essesion.shop`을 추가한다
   (`docs/reviews/image-loading-performance-2026-11-11.md`). 동시 운영 중 `.com`에서 보는 이미지도 원본은 구
   assets 호스트에 있고, 변환은 서빙 존의 소스만 기본 허용한다
   ([Transformation sources](https://developers.cloudflare.com/images/transform-images/sources/)).
4. `www.essesion.com` → `https://essesion.com` 301 Single Redirect를 만든다(프록시된 placeholder 레코드
   AAAA `100::` 필요). 구 존의 www 처리와 같게 한다.
5. Email Routing은 **켜지 않는다**. 켜면 Cloudflare MX·SPF가 잠긴 채 들어간다.

#### A-2. 메일 — iCloud+ 커스텀 이메일 도메인

웹 작업과 독립이다. 인증이 며칠 멈췄다는 사용자 보고가 있어 일찍 시작한다. 쇼핑몰을 장기 소유할 Apple
계정에서 설정한다 — 주소는 한 번 묶이면 다른 Apple 계정으로 옮길 수 없다
([Apple 102540](https://support.apple.com/en-us/102540)).

1. iCloud 설정에서 사용자 설정 이메일 도메인 → "나만 사용" → 도메인 입력 → "기존 주소 없음".
2. 화면이 주는 값으로 Cloudflare DNS에 수동 입력한다([Apple 102374](https://support.apple.com/en-us/102374)).
   끝의 마침표·따옴표는 빼고 넣는다(저장이 안 될 때 Apple이 안내하는 방식).

   | 타입 | 이름 | 값 | 비고 |
   |---|---|---|---|
   | TXT | `@` | 화면이 발급하는 `apple-domain=…` 값 | 도메인별 값 |
   | TXT | `@` | `v=spf1 include:icloud.com ~all` | SPF는 하나만 |
   | MX | `@` | `mx01.mail.icloud.com` (우선순위 10) | |
   | MX | `@` | `mx02.mail.icloud.com` (우선순위 10) | |
   | CNAME | `sig1._domainkey` | 화면이 주는 `sig1.dkim.essesion.com.at.icloudmailadmin.com` | **DNS only(회색 구름)** |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<리포트 주소>` | Apple 요구 아님, 권장 |

3. Verify 후 주소를 만든다(도메인당 1인 10개까지). 대표 주소 하나만 만든다 — 주소명은 실행자가 정한다
   (예: `contact@`).
4. Gmail로 한 통 보내 "원본 보기"에서 `dkim=pass header.d=essesion.com`과 `dmarc=pass`를 확인한다. Apple이
   서명 도메인을 문서화하지 않았고 불일치 일화가 있어, 이 확인 전에는 DMARC를 `p=none`에서 올리지 않는다.
   2주 문제없으면 `p=quarantine`으로 올린다.
5. `essesion.shop`에는 메일 레코드를 추가하지 않는다(구 도메인 수신 메일 없음).
6. 자동 발송 가능 여부를 한 번 확인해 둔다. Apple 계정에서 앱 암호를 만들고 `smtp.mail.me.com:587`
   (STARTTLS, 사용자명은 iCloud 주소)로 보내는 사람을 `@essesion.com` 주소로 지정해 한 통 보낸다.
   Apple 문서는 커스텀 주소 발신을 언급하지 않고 성공·실패 보고가 엇갈린다
   ([Apple 102525](https://support.apple.com/en-us/102525)). 받은 메일의 From과 `dkim=pass`를 확인하고
   결과를 리뷰 문서에 적는다. 거부되면 자동 발송이 필요해질 때 별도 발송 서비스를 고른다.
   테스트용 앱 암호는 확인 후 폐기한다.
7. 메일이 동작하면 사이트의 연락처를 새 주소로 바꾼다 — `apps/store/src/app/layout/app-layout.tsx:241`,
   `apps/store/src/pages/privacy-policy/index.tsx:144`. 도메인 전환을 기다릴 이유가 없다.

#### A-3. 알림톡 새 템플릿 제출

승인된 템플릿은 URL 한 글자도 수정할 수 없어 새로 등록해 검수받아야 한다(영업일 1~3일, 보장 없음 —
[Solapi FAQ](https://solapi.com/guides/kakao-faq)). 본문에 `essesion.shop` 링크가 든 템플릿 전부를
`essesion.com` 링크로 다시 제출한다. 승인돼도 D단계 전까지는 기존 템플릿으로 계속 보낸다.
**2026-12-12 이후에는 기존 템플릿의 링크가 죽으므로, 새 템플릿은 그 전에 반드시 승인·교체돼 있어야 한다.**
반려되면 바로 고쳐 다시 낸다. 가장 먼저 제출할 항목이다.

#### A-4. 외부 콘솔에 새 값 추가

전부 "추가"이고 기존 값은 그대로 둔다.

| 서비스 | 추가할 것 | 근거 |
|---|---|---|
| 카카오 로그인 | Redirect URI `https://api.essesion.com/auth/kakao/callback`, 사이트 도메인 | 미등록 시 KOE006 ([FAQ](https://developers.kakao.com/docs/latest/ko/kakaologin/faq)) |
| 네이버 로그인 | Callback URL `https://api.essesion.com/auth/naver/callback` | Callback은 복수 등록 가능. 서비스 URL은 단일 값이라 C단계에서 바꾼다 |
| 애플 로그인 | Services ID의 Website URLs에 도메인 `essesion.com`·return URL `https://api.essesion.com/auth/apple/callback` | 인증 파일 불필요, 개인 등록은 URL 10개 한도. Services ID 자체는 바꾸지 않는다(`sub` 유지) |
| 구글 로그인 | 승인된 리디렉션 URI에 `https://api.essesion.com/auth/google/callback`, 승인 도메인 | |
| Search Console | `essesion.com` 속성 추가·소유 확인 | 주소 변경 도구의 전제 |
| 네이버 서치어드바이저 | 새 사이트 등록·소유 확인 | 이전 전용 도구는 찾지 못함 |
| PostHog | Authorized URLs에 `https://essesion.com` | 툴바·일부 필터 |
| Sentry | 프로젝트 Allowed Domains가 좁혀져 있으면 새 도메인 추가 | 미확인 — 설정 화면에서 직접 본다 |

### B. 동시 운영 — `.com`을 띄운다

지금 코드는 프론트·api 주소가 하나라고 가정한다. 세 곳을 "허용 목록 안에서 접속한 도메인을 따라가게"
바꾼다. 허용 목록 방식이어야 E단계에서 목록을 하나로 줄이는 것만으로 다시 고정 주소가 된다. 요청에서 읽은
호스트로 리다이렉트 주소를 그대로 조립하지 않는다 — 주소 위조로 엉뚱한 곳에 보내는 통로가 된다.

1. **api-proxy가 원래 호스트를 전달한다.** `infra/cloudflare/api-proxy/src/index.ts:39-41` — 지금은 URL
   호스트를 `run.app`으로 바꾸면서 원래 호스트를 버린다. edge secret을 넣는 자리에서 원래 호스트를 담은
   헤더를 함께 **덮어써서** 넣는다(호출자가 보낸 값은 신뢰하지 않는다 — edge secret과 같은 원칙).
   테스트: `infra/cloudflare/api-proxy/src/index.test.ts`.
2. **api에 사이트 쌍 허용 목록을 둔다.** `apps/api/src/api/config.py:24-28` — 기존 `public_api_origin`·
   `frontend_origin`이 기본 쌍이고, 추가 쌍(api 오리진 ↔ 프론트 오리진)을 받는 설정을 하나 더한다(기본값은
   빈 목록 = 지금과 동일 동작). 같은 검증(`config.py:94-122`의 공개 HTTPS 오리진 규칙)을 추가 쌍에도 적용한다.
3. **소셜 로그인 콜백 주소** — `apps/api/src/api/domains/auth/router.py:177-181`. 1번 헤더의 호스트가 허용
   목록의 api 오리진과 일치하면 그 쌍의 api 오리진으로, 아니면 기본 쌍으로 `redirect_uri`를 만든다.
4. **로그인 후 돌아갈 주소** — `router.py:193-197`, `:230-232`. 콜백은 로그인을 시작한 api 호스트로
   돌아오므로(3번의 `redirect_uri`), 같은 방식으로 쌍을 골라 그 쌍의 프론트 오리진으로 303한다. 별도
   state 전달은 필요 없다. Authlib state 쿠키도 api 호스트별이라 그대로 동작한다(`apps/api/src/api/main.py:264-271`).
5. **명세 갱신** — `docs/api-spec/domains.md:28`의 소셜 콜백 계약에 "`frontend_origin`은 요청이 들어온 api
   호스트에 대응하는 허용 쌍의 값"임을 적는다(대원칙: 명세가 정본). 테스트는 `apps/api/tests/test_auth.py`에
   기본 쌍·추가 쌍·목록에 없는 호스트(기본 쌍으로 떨어짐) 세 경우를 둔다.
6. **프론트의 api 주소** — `apps/store/src/shared/config/env.ts:2-3`. 접속 호스트가 `essesion.com`이면
   `https://api.essesion.com`, 그 외에는 지금처럼 `VITE_API_BASE_URL`을 쓴다. refresh 쿠키가 api 호스트 전용
   `SameSite=Lax`라(`apps/api/src/api/domains/auth/router.py:56-74`) 프론트와 api의 등록 도메인이 다르면
   로그인이 깨진다. 로그인 시작 링크(`apps/store/src/pages/auth/login.tsx:105`,
   `apps/store/src/features/auth/model/naver-autologin.ts:48`)와 api 클라이언트(`apps/store/src/shared/lib/api-client.ts:73`)는
   같은 상수를 쓰므로 따로 고칠 것이 없다.
7. **호스트명 추가** — `apps/store/wrangler.jsonc:17-20`에 `essesion.com`, `infra/cloudflare/api-proxy/wrangler.jsonc:9`에
   `api.essesion.com`을 **추가**한다(기존 항목 유지). `.github/workflows/deploy.yml:165-168`의 배포 검증이
   두 api 호스트를 모두 확인하게 고친다. **한 Worker가 서로 다른 두 존의 커스텀 도메인을 동시에 갖는 구성은
   문서에 명시가 없다(추정).** 배포가 실패하면 신 호스트용 Worker를 이름만 달리해 따로 배포한다.
8. **허용 오리진 추가** — api `CORS_ORIGINS`와 GCS 업로드 CORS(`infra/variables.tf:104-109`의
   `upload_cors_origins` 또는 tfvars 재정의)에 `https://essesion.com`을 추가하고, 2번의 추가 쌍
   (`https://api.essesion.com` ↔ `https://essesion.com`)을 `production.tfvars`의 `api_extra_env`에 넣는다.
   `apps/store/public/_headers:2`의 CSP `connect-src`에 `https://api.essesion.com`을 추가한다.
9. **그대로 두는 것과 이유**
   - 검색 정본·사이트맵(`apps/store/src/shared/seo/page-meta.tsx:6` 등) — `.shop` 고정이라 `.com`으로 접속해도
     canonical이 `.shop`을 가리킨다. 같은 내용이 두 주소에 뜨는 동안 중복 색인을 막는 의도된 상태다.
   - 알림톡·문자 링크 — 메시지에는 주소를 하나만 넣을 수 있고, 정본이 `.shop`인 동안에는 `.shop`이 맞다.
     이미 발송된 메시지의 링크는 영영 `.shop`이고, 2026-12-12 만료 뒤에는 열리지 않는다(E-5에서 감수).
   - assets 호스트 — 신·구 주소가 같은 버킷을 가리켜 옮겨도 달라지는 것이 없다. 호스트를 미리 바꾸면
     CSP·이미지 변환 설정만 두 벌이 된다. D단계에서 한 번에 바꾼다.
   - Toss 웹훅 — 같은 백엔드라 구 주소 하나로 충분하다. admin — 범위 밖 참조.
10. `.com`에서 "검증" 절의 브라우저 실측을 한다. **결제는 이 단계의 통과 조건이 아니다**(결제 전제 참조) —
    시도는 해 보고 결과만 기록한다. `.shop`에서는 결제를 포함한 전 항목이 여전히 되는지 함께 본다.
11. 토스 승인 직후 바로 전환할 수 있게 D단계를 준비해 둔다. D-1의 저장소 변경과 D-6의 마이그레이션 파일은 별도 브랜치에 PR로 만들어
    CI까지 통과시키고 머지하지 않는다. D-2·D-3에서 바꿀 운영 값은 바꿀 값을 미리 적어 둔다. D-7의 Single
    Redirect 4개는 구 존에 **비활성 상태로** 미리 만들어 둔다.

### C. 변경 신청 — B의 실측(결제 제외)이 통과하고 D단계 PR이 준비된 뒤

승인 진행 중에는 리다이렉트 없이 두 주소를 그대로 운영한다. 손님은 검색·알림톡 링크를 따라 `.shop`으로
들어와 `.shop`에서 결제한다. `.com`은 알려지지 않은 주소이고, 이 기간에 `.com`에서 결제가 안 되는 것은
감수한다. 승인이 나면 곧바로 D로 넘어간다 — 승인 후 `.shop`을 넘기기 전까지가 `.shop` 결제가 안 될 수 있는
틈이므로, 신청은 승인 연락을 바로 받고 움직일 수 있는 날에 한다.

1. 토스 상점관리자 > 회사정보 > 서비스별 정보 > 홈페이지 정보에서 주소를 `https://essesion.com`으로 바꾼다
   (또는 고객센터 1544-7772). 새 도메인 푸터에 사업자 정보·통신판매업 신고번호가 그대로 보여야 한다
   ([카드사 심사 체크리스트](https://www.tosspayments.com/blog/articles/53711)).
2. 네이버 개발자센터에서 네이버 로그인 서비스 URL을 `https://essesion.com`으로 바꾼다.
3. 두 변경이 완료된 것을 각 콘솔에서 확인한다. 처리 중에는 하루에 몇 번 상점관리자를 확인한다.
4. 토스 승인을 확인하는 즉시 `.com`에서 실결제 1건을 하고 취소한다. 성공하면 바로 D를 실행한다.
   실패하면 D를 실행하지 말고 "되돌리는 법"의 C 항목을 따른다.

### D. 전환 — C의 완료를 확인한 뒤

1. 저장소 치환 — `docs/reviews/`를 뺀 전 파일에서 `essesion.shop` → `essesion.com`. 예외와 주의:
   - `apps/store/wrangler.jsonc` — routes를 `essesion.com` 하나로. `essesion.shop`·`app.` 항목은 지운다.
   - `apps/admin/wrangler.jsonc:9` — `admin.essesion.com`.
   - api-proxy는 **구 호스트 항목을 남긴다**(이미 발급된 세션·웹훅·콜백용).
     `infra/cloudflare/assets-proxy/wrangler.jsonc:11`에는 `assets.essesion.com`을 추가하고 구 항목을 남긴다.
   - `apps/store/public/_headers:2`, `apps/admin/public/_headers:2` — CSP를 새 api·assets 호스트로 바꾸되
     `img-src`의 `https://assets.essesion.shop`은 남긴다. D-6의 DB 갱신이 끝날 때까지 구 주소 이미지가
     보여야 한다. E-4에서 지운다.
   - `apps/store/src/shared/lib/image-url.ts:4` — `ASSETS_ORIGIN`을 새 호스트로. 같은 이유로 D-6 전까지는 구
     오리진도 변환 대상으로 인식하게 둔다(A-1의 허용 소스도 그대로). E-4에서 지운다.
   - SEO: `apps/store/src/shared/seo/page-meta.tsx:6`, `apps/store/index.html:21`,
     `apps/store/public/robots.txt:11`, `apps/store/public/sitemap.xml`, `apps/store/src/pages/home/index.tsx:19-51`,
     `apps/store/src/pages/custom-order/index.tsx:429-430`, `apps/store/src/pages/shop/detail.tsx:57,72`.
   - 발송 문구: `apps/api/src/api/domains/orders/service.py:1168`, `apps/api/src/api/domains/claims/service.py:301,307`.
     정본 명세 `docs/api-spec/domains.md:21,49`를 같은 커밋에서 갱신한다. (참고: 클레임 완료 링크가 명세는
     `/order/claim-list`, 코드는 `/my-page/claims`로 이미 어긋나 있다 — 이 플랜에서 고치지 말고 별도로 보고한다.)
   - 인프라 기본값·문서: `infra/variables.tf:57,107-108`, `infra/production.tfvars.example`, `infra/README.md`,
     `infra/cloudflare/README.md`, `ARCHITECTURE.md:24,121`.
2. 운영 값 전환 — 두 번에 나눠 한다. **머지 전**: GitHub Actions 변수 `VITE_API_BASE_URL`을 새 도메인으로
   (빌드 시점 값이라 먼저 바꿔야 한다). **5번 배포로 `assets.essesion.com`·`admin.essesion.com`이 뜬 뒤**:
   `production.tfvars`에서 기본 쌍을 `.com`으로 바꾸고 `.shop` 쌍을 추가 쌍으로 내리고(`public_api_origin`·
   `FRONTEND_ORIGIN`), `ADMIN_FRONTEND_ORIGIN`·`PUBLIC_ASSETS_ORIGIN`을 새 도메인으로 바꿔 apply한다. 순서를
   바꾸면 api가 아직 없는 `assets.essesion.com` 주소를 내려 준다. `CORS_ORIGINS`는 신·구 모두 유지하고, GCS
   업로드 CORS에 `https://admin.essesion.com`을 추가한다(admin 이미지 업로드). 이 사이 admin은 잠시 로그인이
   안 될 수 있다(사용자가 운영자 한 명이라 감수).
3. 승인된 새 알림톡 템플릿 ID로 `SOLAPI_TEMPLATE_*` 값을 바꾼다. 미승인이면 기존 ID를 유지하되, 승인되는
   대로 바꾼다(E의 필수 항목 — A-3 참조).
4. 토스 개발자센터 > 웹훅에 `https://api.essesion.com/payments/webhook`을 추가 등록한다(수정 기능이 없다 —
   [웹훅 문서](https://docs.tosspayments.com/guides/v2/webhook)). 중복 수신은 안전하다(실행 조건의 확인 완료
   항목). 전환 뒤 `.com` 결제 1건에서 새 웹훅이 수신된 것을 api 로그로 확인하면 구 웹훅을 바로 삭제한다.
5. main 머지 → CI → 배포.
6. **DB의 이미지 주소를 갱신한다.** `assets.essesion.com`이 200을 주는 것을 확인한 뒤, 상품 이미지 컬럼
   (대표 이미지·상세 이미지)의 `https://assets.essesion.shop/` 접두를 `https://assets.essesion.com/`으로
   바꾸는 데이터 마이그레이션을 Alembic으로 실행한다(대원칙: DB 변경은 Alembic 경유). 실행 전후로
   `assets.essesion.shop`을 포함한 행 수를 세어 0이 됐는지 확인하고, 다른 테이블에도 같은 문자열이 있는지
   함께 센다. 마이그레이션 파일은 B-11의 준비 PR에 포함한다.
7. 구 존 리다이렉트를 켠다. 배포로 `essesion.shop`·`app.`·`admin.`의 커스텀 도메인이 빠진 것을 확인한 뒤
   (빠지지 않았으면 대시보드에서 수동으로 뗀다), 각 호스트에 프록시된 placeholder(AAAA `100::`)를 넣고
   B-11에서 만들어 둔 Single Redirect를 활성화한다(Free는 존당 10개). 커스텀 도메인이 빠진 뒤 규칙을 켜기
   전까지는 `.shop`이 응답하지 않으므로 이 구간을 몇 분 안에 끝낸다.
   **Preserve query string을 켠다(기본 꺼짐).** 처음 48시간은 **302**로 두고 문제없으면 301로 바꾼다 —
   301은 브라우저가 캐시해 되돌리기 어렵다.

   | Request URL | Target URL |
   |---|---|
   | `http*://essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://app.essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://www.essesion.shop/*` | `https://essesion.com/${2}` (기존 www 규칙을 교체) |
   | `http*://admin.essesion.shop/*` | `https://admin.essesion.com/${2}` |

   형식은 [공식 예제](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-all-different-hostname/)와 같다.
   `api.`·`assets.`에는 규칙을 걸지 않는다 — 301/302는 POST를 GET으로 바꿀 수 있고
   ([Single Redirects settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/)),
   웹훅 발신자가 리다이렉트를 따른다는 보장이 없다.
8. GA4 웹 스트림 URL을 새 도메인으로 바꾼다.
9. **301로 바꾼 뒤**: Search Console 구 속성에서 "주소 변경"을 제출하고 새 사이트맵을 낸다. GA4 ↔ Search
   Console 연결은 편집할 수 없으므로 삭제 후 새 속성으로 다시 만든다
   ([Analytics Help](https://support.google.com/analytics/answer/10737381?hl=en)). 서치어드바이저에도 사이트맵 제출.

### E. 정리 — D의 301 전환 후 14일이 지난 뒤, 늦어도 2026-12-11까지

2026-12-12에 `.shop`이 만료되므로 이 단계는 미룰 수 없다. 끝났을 때 `git grep 'essesion\.shop' -- ':!docs/reviews'`
가 비어 있고, 운영 설정·외부 콘솔·DB 어디에도 `.shop` 주소가 남아 있지 않아야 한다.

정리 시점의 근거는 두 가지다.

- **14일**: 로그인 유지 토큰 수명이 14일이다(`apps/api/src/api/config.py:33`의 `refresh_ttl_days`). D 이후
  `.shop` 화면은 리다이렉트돼 새 세션이 생기지 않으므로, 14일이 지나면 `api.essesion.shop`에 묶인 세션은
  전부 만료된다. 그 전에 구 호스트를 없애면 열어 둔 탭의 사용자가 조용히 로그아웃된다.
- **남은 요청 확인**: 정리 전에 Cloudflare 대시보드(구 존 > Analytics, 호스트 `api.essesion.shop` 필터)에서
  최근 요청을 본다. 구 웹훅은 D-4에서 이미 지웠으므로 요청이 없어야 정상이다. 남아 있으면 출처를 확인해
  새 주소로 옮긴다. 다만 **기한이 우선이다** — 2026-12-12에는 구 주소가 어차피 사라지므로, 출처를 못 찾아도
  2026-12-11에는 정리를 끝낸다.

1. 허용 쌍 목록에서 `.shop` 쌍을 뺀다 — 이 순간 다시 고정 주소다. `CORS_ORIGINS`·GCS CORS·CSP에서 구
   오리진을 뺀다.
2. B-6의 프론트 분기를 지우고 `apps/store/src/shared/config/env.ts`를 빌드 시 고정값으로 되돌린다. `.shop`이
   리다이렉트된 뒤에는 죽은 코드다.
3. 구 Redirect URI·Callback·구 알림톡 템플릿을 각 콘솔에서 지운다. 이 시점에 `SOLAPI_TEMPLATE_*`가 전부 새
   템플릿 ID인지 확인한다 — 기존 템플릿이 하나라도 남아 있으면 만료 뒤 죽은 링크가 발송된다.
4. api-proxy·assets-proxy의 구 호스트 항목, `deploy.yml`의 구 호스트 검증, CSP와 `image-url.ts`의 구 assets
   예외, 새 존 Image Transformations 허용 소스의 `assets.essesion.shop`을 지운다. DB에 구 assets 절대 URL이
   있었다면 그 갱신이 끝난 뒤에 한다. 지운 커스텀 도메인의 인증서는 Edge Certificates에서 수동 삭제한다.
5. `essesion.shop`은 연장하지 않고 2026-12-12에 만료시킨다(2026-11-12 운영자 결정). 리다이렉트는 전환부터
   만료까지 2~3주만 살아 있다. 감수하는 것:
   - 만료 전에 발송된 알림톡·문자의 `.shop` 링크와 손님의 즐겨찾기는 만료 뒤 열리지 않는다.
   - Google은 주소 변경 후 리다이렉트를 최소 180일 유지하라고 한다
     ([Search Console Help](https://support.google.com/webmasters/answer/9370220?hl=en)). 그보다 짧아 검색
     순위가 `.com`으로 다 넘어오지 않을 수 있고, `.com`이 새 사이트처럼 다시 쌓일 수 있다.
   - 만료된 도메인은 일정 기간 뒤 누구나 다시 등록할 수 있다. 옛 링크가 남의 사이트로 연결될 수 있다.
   구 존의 HSTS(max-age 30일)는 D 직후에 끈다 — 만료 뒤 남이 등록한 사이트에 영향을 주지 않게 정리한다.
6. 결과를 `docs/reviews/domain-move-essesion-com-<날짜>.md`에 기록하고 이 플랜을 지운다.
   `docs/plans/cloud-security-hardening.md` §1의 검증 명령 도메인도 그때 고친다.

## 검증

```bash
# 메일 (A-2)
dig +short MX essesion.com                       # mx01/mx02.mail.icloud.com
dig +short TXT essesion.com                      # apple-domain=…, v=spf1 include:icloud.com ~all
dig +short CNAME sig1._domainkey.essesion.com    # …icloudmailadmin.com (평탄화되지 않은 CNAME)

# 동시 운영 (B)
uv run pytest apps/api/tests/test_auth.py apps/api/tests/test_config.py
pnpm --filter store test && pnpm lint && pnpm architecture:check
curl -fsS https://api.essesion.com/readyz
curl -fsS https://api.essesion.shop/readyz
curl -sI -H 'Origin: https://essesion.com' 'https://api.essesion.com/products?limit=1' | grep -i access-control-allow-origin
curl -sI https://api.essesion.com/auth/kakao/login | grep -i '^location'    # redirect_uri가 api.essesion.com
curl -sI https://api.essesion.shop/auth/kakao/login | grep -i '^location'   # redirect_uri가 api.essesion.shop
curl -s https://essesion.com/ | grep -o 'rel="canonical"[^>]*'              # .shop을 가리켜야 한다 (D 전까지)

# 전환 (D)
curl -sI 'https://essesion.shop/shop?utm_source=x' | grep -i '^location'   # https://essesion.com/shop?utm_source=x
curl -sI https://admin.essesion.shop/ | grep -i '^location'
git grep -n 'essesion\.shop' -- ':!docs/reviews'   # 남는 것은 이중 서빙 항목과 의도한 CSP 예외뿐
```

브라우저 실측 — B단계에서는 `.com`과 `.shop` 양쪽, D단계 뒤에는 `.com`에서:
소셜 로그인 4종 각각(로그인을 시작한 도메인으로 돌아오는지), 이미지 업로드(GCS CORS), 상품 이미지
변환(`/cdn-cgi/image`). 실결제 1건과 취소·웹훅 수신은 B단계에서는 `.shop`만, `.com`은 토스 승인 직후(C-4)와
D단계 뒤에 한다. D단계 뒤 추가: 배송 시작 알림톡 1건의 링크, admin 로그인.
메일은 대표 주소로 외부 송수신.

## 되돌리는 법 / 상향 신호

- **A**: 전부 추가라 되돌릴 것이 없다. iCloud Mail이 장애로 수신을 멈추면 DNS가 Cloudflare에 있으므로 MX를
  다른 사업자로 바꾸면 된다(TTL 3600).
- **B**: `.shop`에서 로그인·결제가 실패하면 즉시 되돌린다. B의 커밋을 revert해 재배포하면 추가 쌍 설정이
  비어 있는 것과 같은 기존 동작으로 돌아간다. `.com` 호스트명은 남아 있어도 `.shop` 영업에 영향이 없다.
- **C**: 승인 전에 `.shop`에서 결제나 네이버 로그인이 막히면 토스·네이버에 원인을 확인한다. 승인 후
  `.com` 실결제(C-4)가 실패하면 D를 실행하지 말고 토스에 문의하되, 그동안 `.shop` 결제도 막혀 있으면 등록
  주소를 `.shop`으로 되돌려 달라고 요청한다 — 두 주소 모두 결제가 안 되는 상태를 오래 두지 않는다.
- **D**: 신호는 새 도메인에서 결제 승인 실패 또는 소셜 로그인 2종 이상 실패. 되돌리면 손님이 `.shop`으로
  돌아가는데, 토스 등록 주소가 이미 `.com`이라 결제 전제상 `.shop` 결제가 안 될 수 있다. 그래서 **먼저
  `.com`에서 고쳐서 해결하는 것을 우선**하고, 되돌리는 것은 `.com`에서 결제 자체가 안 될 때만 한다.
  되돌릴 때: ① 구 존의 Single Redirect를 끄고 placeholder 레코드를 지운다(레코드가 남아 있으면 커스텀
  도메인 재생성이 충돌할 수 있다). ② D-1 커밋을 revert하고 D-2의 운영 값을 되돌려 재배포한다 — B의 동시
  운영 상태로 돌아간다. ③ `.shop`에서 실결제 1건을 시험하고, 안 되면 토스에 등록 주소를 `.shop`으로
  되돌려 달라고 요청한다. 302 기간(48시간) 안에 되돌리면 브라우저 캐시에 남는 것이 없다.

- **일정 상향 신호**: D의 301 전환이 **2026-11-27까지 끝나지 않으면** `.shop`을 1년 연장한다(A-0). 그날을
  넘기면 E의 14일을 채우지 못한 채 영업 중인 주소가 만료된다. 알림톡 검수 반려, 토스 승인 지연, B단계
  배포 실패가 대표적 원인이다. 연장하면 기한 표의 날짜는 모두 풀린다.

방문자는 새 도메인에서 한 번 로그아웃 상태가 되고 비회원 장바구니 등 로컬 상태를 잃는다. 로그인 상태는
넘겨줄 방법이 있지만 하지 않기로 했다(기각한 대안 참조). 로컬 상태는 오리진이 바뀌는 한 옮길 수 없다.

## 기각한 대안

- **한 번에 전환(동시 운영 없이 컷오버)** — 인증 코드를 건드리지 않아 가볍지만, 토스·네이버 변경을 신청할
  때 새 주소에 사이트가 없거나, 등록 주소가 맞지 않는 채로 전환부터 하고 결제를 시험하게 된다. 2026-11-12
  운영자 결정으로 기각. 재론 조건 없음.
- **`.shop` 1년 연장 후 여유 있게 이전** — 리다이렉트를 1년 유지해 옛 링크와 검색 순위를 지킬 수 있지만,
  연장비가 약 7만 원으로 `.com` 1년(약 1만 원)의 7배라 내지 않고 한 달 안에 끝내기로 했다(2026-11-12
  운영자 결정). D가 2026-11-27까지 끝나지 않으면 재론이 아니라 바로 연장한다(되돌리는 법의 일정 상향 신호).
- **Cloudflare Email Routing + Gmail 발신** — Gmail "다른 주소에서 보내기"가 2027-01에 제거된다. 재론 조건 없음.
- **Zoho Mail 무료·Purelymail(연 $10)** — iCloud+를 이미 내고 있어 추가 가입·비용이 불필요. iCloud 메뉴가
  한국 계정에 없거나 인증이 끝내 실패하면 재론한다.
- **Google Workspace·네이버웍스** — 월 과금. 직원이 생겨 공용 사서함·관리 콘솔이 필요해지면 재론한다.
- **로그인 상태를 새 도메인으로 넘겨주기** — 구 도메인이 1분짜리 암호화 토큰을 만들어 새 도메인에 넘기고
  새 도메인이 쿠키를 다시 심는 방식([Inflection 사례](https://www.youssefm.com/posts/transferring-cookies)).
  인증 경로에 임시 코드가 하나 더 생기는데, 방문자가 적고 소셜 로그인이라 다시 로그인하는 부담이 버튼 한
  번이다. 재로그인 불만이 실제로 들어오면 재론한다.
- **요청 호스트로 리다이렉트 주소를 그대로 조립** — 허용 목록 없이 호스트 헤더를 믿으면 로그인 후 임의
  도메인으로 보내는 통로가 된다. 허용 쌍 목록으로만 고른다.
- **구 존 전체를 와일드카드 한 줄로 리다이렉트**(`http*://*.essesion.shop/*`) — api·assets까지 잡아 POST·웹훅이
  깨진다. 호스트별 규칙 4개가 한도(10개) 안이다.
- **api 구 호스트를 리다이렉트로 돌리기** — 웹훅·서버 간 호출이 리다이렉트를 따르는지 확인할 수 없다.
  구 호스트는 E에서 그냥 떼고, 2026-12-12 만료로 사라지게 둔다.
