# 로고 배경별 변형 · 대표 메일 help@essesion.com · 견적서 메일 발송

2026-11-18 운영자 요청. 세 항목(A·B·C)은 서로 독립이며 PR도 따로 낼 수 있다. 위에서부터 실행한다
(쉬운 것 → 큰 것). A·B는 조건 없이 실행할 수 있고, C는 메일 기반 확인(수신·SMTP 발신·DKIM 정렬)이
2026-11-18에 끝났지만 **운영자 확인 두 가지**(실행 조건)가 남아 있다.

이 플랜의 실패 모드는 둘이다. ① C에서 아무 주소로나 메일을 보낼 수 있는 통로를 만들어 `help@essesion.com`이
스팸·피싱 발송기가 되는 것 — 로그인, 횟수 제한(사용자별·전체), 고정 본문 세 가지가 방어선이므로 하나도
빼지 않는다. ② 견적서의 옵션 표기가 store 화면과 어긋나는 것 — 라벨이 TS(store)와 Python(api) 두 곳에
생기기 때문이다(C-4).

## 왜 필요한가

- **로고**: 지금 로고는 한 장(`apps/store/public/logo/logo.png`, admin도 같은 파일 — md5 동일), 검정
  사각형 위 흰 글자(ㅇㅅ/ㅅㅇ)다. 이 로고가 올라가는 헤더 배경은 흰색(`bg.layer-default`,
  `packages/shared/src/components/header.tsx:86`)이라 흰 화면 위에 검정 사각형이 떠 보인다. 운영자 결정
  (2026-11-18): **로고는 놓이는 배경과 같은 배경색을 갖는다** — 흰 배경 위엔 흰 바탕·검정 글자, 검정 배경
  위엔 검정 바탕·흰 글자. store·admin 공통.
- **대표 메일**: 사이트의 연락처가 개인 메일(`biblecookie@naver.com`)이다. 운영자가 사무용 주소
  `help@essesion.com`(iCloud+ 커스텀 도메인)을 만들었다(2026-11-18). 사이트의 모든 안내 메일 주소를 이것으로
  통일한다. 도메인 이전 리뷰의 "남은 확인 — 사이트 연락처 교체"
  (`docs/reviews/domain-move-essesion-com-phase-ab-2026-11-12.md`)가 이 항목이다.
- **메일 사업자를 iCloud+로 한 이유** (도메인 이전 플랜에서 옮김, 2026-11-12 운영자 결정): 1인 운영이라 월
  과금 메일은 쓰지 않고, iCloud+는 이미 구독 중이라 추가 비용이 없다. Gmail의 타사 주소 "다른 주소에서
  보내기"는 2027년 1월에 제거되므로([Google 공지](https://support.google.com/mail/answer/17101213?hl=en))
  전달 + Gmail 발신 방식은 쓸 수 없다.
- **메일 기반 현황**: `essesion.com` 존(Cloudflare)에 iCloud+ 레코드(MX 2, SPF, `apple-domain` TXT, DKIM
  CNAME — 모두 DNS only)와 `_dmarc`(`v=DMARC1; p=none`)가 있다. Email Routing은 꺼져 있다. `essesion.shop`에는
  MX가 없다(2026-11-11 확인 — 구 도메인으로 받는 메일 없음). 수신·SMTP 발신·DKIM/SPF/DMARC 정렬은
  2026-11-18에 실측으로 확인했다(아래 "확인해 둔 것").
- **견적서 메일**: 주문 제작 페이지(`/custom-order`)에서 고른 사양과 예상 금액을 고객이 메일로 받아 내부
  결재·비교에 쓰게 한다. 발신 주소는 `help@essesion.com`. 지금 api는 메일을 보내지 않는다(알림톡·LMS만).

## 범위 밖

- 파비콘·apple-touch-icon·og-image 교체. 브라우저 탭·SNS 카드의 배경은 우리가 정하지 않으므로 지금의
  검정 바탕을 유지한다. 바꾸고 싶으면 별도 결정.
- 견적서 PDF 첨부. 본문 HTML 표로 시작한다. 고객이 "PDF로 달라"는 요청이 실제로 들어오면 그때 추가.
- 견적서에 수신 업체명·담당자명·메모 같은 **고객 입력 문구**를 싣는 것. 우리 도메인 명의 메일에 임의
  문구가 실리면 피싱 통로가 된다(실패 모드 ①). 필요해지면 "본인 계정 메일로만 발송"과 묶어 재론.
- 견적서 발송 이력 DB 저장·admin 화면. 로그로 충분하다. 발송 건을 운영자가 봐야 하면 그때 테이블 추가.
- 수동 견적(100개 이상, admin이 금액을 정해 보내는 `quote_sent` 알림톡) 흐름 변경. 그대로 둔다.
- DMARC 정책 상향(`p=none` → `quarantine`). 발신이 정렬돼 있어 올려도 깨지지 않지만 이 플랜에서 하지 않는다.
- 계측 이벤트 추가. 금지라서가 아니라 이미 있는 것으로 충분해서다 — 버튼·모달 "보내기" 클릭은 PostHog
  autocapture가 잡고(`apps/store/src/shared/lib/product-analytics.ts:43`에서 꺼져 있지 않고 `/custom-order`는
  마스킹 경로가 아니다, 2026-11-18 확인), 실제 발송 수는 api 로그(C-3)에 남는다. `docs/analytics.md`는
  이벤트를 늘리기 전에 한 번 더 생각하라고 한다. 한계: 버튼 문구를 바꾸면 집계가 끊기고 GA4에는 안 보인다.
  "견적서 수령 → 주문" 전환을 지표로 쓰게 되면 그때 이벤트 하나를 추가한다.

## 실행 조건

- A·B: 조건 없음. 단, B-3은 도메인 전환 PR #112와 같은 파일을 건드린다(절차에 적음).
- **C는 아래 두 가지를 운영자에게 확인한 뒤에만 실행한다.** 답이 없으면 C-4(본문)에서 멈추고 기다린다 —
  금액 고지를 추측으로 쓰지 않는다.
  1. **부가세 표기**: 화면의 예상 금액이 부가세 포함인지 별도인지. 저장소 어디에도 표기가 없다
     (2026-11-18 `rg "부가세|VAT"` 0건). 결재용 견적서는 이 문구가 필수다.
  2. **견적 유효기간 문구**: "발행일로부터 N일" 같은 문구를 넣을지. 가격 상수는 admin이 언제든 바꿀 수
     있으므로(`docs/api-spec/money.md` §3 pricing_constants) 넣지 않으면 "주문 시점 금액이 적용됩니다"만 쓴다.

확인해 둔 것(모두 2026-11-18 실측):

- `help@essesion.com` 수신 정상(운영자 확인).
- SMTP 발신: `smtp.mail.me.com:587`(STARTTLS)로 `From: help@essesion.com` 한 통을 Gmail로 보내 받은편지함
  도착, 보낸 사람 유지. 로그인 아이디는 **계정의 `@icloud.com` 주소**다 — Apple 계정 로그인 주소(외부
  메일)는 `550 5.1.1 Mailbox does not exist`, 계정 비밀번호는 `535 5.7.8 authentication failed`로 거절된다.
  암호는 account.apple.com > 로그인 및 보안 > 앱 암호에서 만든 것만 받는다.
- 인증: 같은 메일 원본에서 `dkim=pass header.i=@essesion.com header.s=sig1`,
  `spf=pass smtp.mailfrom=help@essesion.com`, `dmarc=pass header.from=essesion.com`.
- 한도: iCloud 하루 1,000통([Apple 102198](https://support.apple.com/en-us/102198)). 비용: 기존 iCloud+
  구독 안이라 추가 비용 없음(2026-11-12 운영자 확인).

알고 실행할 것:

- **앱 암호는 운영자 개인 iCloud 계정의 열쇠다.** 메일 발송만이 아니라 그 계정의 메일함 접근에도 쓰일 수
  있으므로(앱 암호는 용도 제한이 없다 — 추정, Apple 문서에 범위 제한 언급 없음) api 전용으로 하나 따로
  만들고(이름 예: `essesion-api-smtp`), 유출 의심 시 그 암호만 폐기한다. 테스트에 쓴 암호를 재사용하지 않는다.

## 절차

### A. 대표 메일 주소 교체 (help@essesion.com)

1. `apps/store/src/app/layout/app-layout.tsx:242` 푸터 `이메일:` → `help@essesion.com`.
2. `apps/store/src/pages/privacy-policy/index.tsx:144` 개인정보 보호책임자 이메일 → 같은 주소.
   방침 본문이 "변경되면 시행일과 주요 변경사항을 공지사항을 통해 알린다"고 적고 있으므로(`:151`), 같은
   파일 `:155`의 시행일을 배포일로 고치고 `apps/store/src/pages/notice/model/notice-data.ts`에 "개인정보
   보호책임자 연락처 변경" 공지 한 건을 추가한다. 다른 조항은 건드리지 않는다.
3. `packages/shared/AGENTS.md:5` 사업자 표기의 이메일 → 같은 주소(에이전트가 새 화면에 옛 주소를 쓰지
   않게 하는 정본).
4. 실행 시점에 `rg -n "biblecookie|@naver\.com" apps packages docs/api-spec`로 남은 곳을 다시 훑는다.
   테스트 픽스처(`apps/api/tests/test_auth.py`의 `user@naver.com`)는 연락처가 아니므로 제외.
5. 저장소 밖(운영자 작업): 솔라피 알림톡 템플릿 본문, 토스 상점관리자·네이버 개발자센터·카카오 비즈니스
   채널의 담당자 메일에 옛 주소가 있으면 바꾼다. 코드 변경과 독립이라 순서 무관.

### B. 로고 배경별 변형

1. 밝은 배경용 한 장만 새로 만든다 — `logo-light.png`(흰 바탕·검정 글자). 기존 `logo.png`(검정 바탕·흰
   글자)는 **이름을 바꾸지 않고 어두운 배경용으로 그대로 둔다**(외부에 퍼진 URL과 도메인 전환 PR을
   건드리지 않기 위해).
   - 생성: 원본은 RGBA 1024×1024, 불투명. RGB만 반전한다 —
     `magick logo.png -channel RGB -negate logo-light.png`(로컬에 `/opt/homebrew/bin/magick` 있음).
     반전 후 400% 확대해 글자 가장자리에 색 띠가 없는지 본다.
   - 위치: `apps/store/public/logo/`, `apps/admin/public/logo/` 양쪽에 같은 파일.
     `/logo/*`는 `public/_headers`의 하루 캐시(`/images/*`) 대상이 아니다.
2. 헤더(흰 배경) 참조를 light로:
   - `apps/store/src/app/layout/app-layout.tsx:110` `brandLogoSrc` → `/logo/logo-light.png`
   - `apps/admin/src/widgets/admin-shell/admin-header.tsx:37` → 같은 값
   - `packages/shared/src/components/header.tsx:107-116`은 그대로 둔다(경로만 받는다). 흰 바탕 로고가 흰
     헤더에 녹아 글자만 보이는 것이 의도다.
3. `apps/store/src/pages/home/index.tsx:23` 구조화 데이터 `logo`의 **파일명만** `logo-light.png`로 바꾼다
   (검색 결과 배경이 흰색). 호스트는 그 시점 값을 유지한다 — `.shop` → `.com` 치환은 PR #112(도메인
   전환)의 몫이고, 이 줄은 #112와 충돌하므로 #112가 먼저 머지됐으면 그 위에서, 아니면 #112를 리베이스할 때
   파일명 변경을 살린다.
4. 규칙을 하네스에 한 줄 추가: `packages/shared/AGENTS.md`의 사업자 표기 아래 —
   "로고는 놓이는 배경과 같은 바탕색: 밝은 배경 `/logo/logo-light.png`, 어두운 배경 `/logo/logo.png`".
   지금 어두운 배경에 로고가 놓인 화면은 없다(2026-11-18 `rg logo` 기준) — `logo.png`의 화면 참조처는
   0이 되지만 규칙상 남긴다.

### C. 견적서 메일 발송

동작: 로그인한 고객이 `/custom-order`에서 "견적서 메일로 받기"를 누르면 모달에서 받을 주소를 확인하고,
api가 **서버에서 금액을 다시 계산**해 고정 양식의 메일을 `help@essesion.com` 명의로 보낸다.
순서는 1→7. 1~5는 api, 6은 store, 7은 운영 배선이며 **7을 6보다 먼저 배포하지 않아도 된다**(미설정이면
503으로 안내 — C-1).

1. **메일 클라이언트** — `apps/api/src/api/integrations/mailer.py` 신규.
   - 표준 라이브러리 `smtplib` + `email.message.EmailMessage`만 쓴다(의존성 추가 없음). 동기 호출은
     `asyncio.to_thread`로 감싸고 SMTP 타임아웃은 10초 — 요청이 메일 서버에 오래 붙잡히지 않게.
   - 구조는 `apps/api/src/api/integrations/solapi.py:90-143`을 그대로 따른다: `RealMailer` /
     `DryRunMailer`(보낸 메시지를 `sent` 리스트에 쌓고 로그) / `UnavailableMailer` + `build_mailer(settings)`.
     설정이 다 차면 Real, `settings.env in ("local", "test")`면 DryRun, 그 외(운영 미설정)는 Unavailable.
     근거: 운영에서 조용히 "보낸 척" 하지 않는다는 기존 계약.
   - `apps/api/src/api/main.py:184`(solapi 옆)에서 `app.state.mailer`로 올리고 `:190`의 capabilities에
     `"mailer"`를 더한다.
2. **설정** — `apps/api/src/api/config.py`(solapi 블록 `:69` 근처): `smtp_host`(기본 `smtp.mail.me.com`),
   `smtp_port`(587), `smtp_username`, `smtp_password`, `mail_from`(기본 `help@essesion.com`).
   레이트리밋 값도 기존 관례대로 설정 필드로 둔다(C-3). `.env.example`에 키 이름만 추가.
3. **엔드포인트** — `POST /orders/custom/estimate-email`,
   `apps/api/src/api/domains/orders/router.py:61`(`calculate_custom_order`) 옆.
   - 요청: `CustomAmountRequest`(`schemas.py:77`)에 `email`을 더한 스키마. 금액 필드는 받지 않는다.
     `email`은 `str` + `Field(max_length=320, pattern=…)`(공백·개행 없는 `x@y.z` 꼴)로 검증한다 —
     `EmailStr`는 `email-validator` 의존성이 필요한데 지금 설치돼 있지 않다(2026-11-18 `uv.lock` 확인).
     개행 금지가 핵심이다(헤더 주입 차단. `EmailMessage`도 개행 든 헤더를 거부하지만 422로 먼저 막는다).
   - 인증: `CurrentUser` 필수. 계산 API는 공개지만 메일 발송은 외부로 나가는 부작용이다.
   - 횟수 제한 — 로그인만으로는 부족하다(소셜 로그인으로 누구나 가입). `AuthRateLimiter`
     (`apps/api/src/api/domains/auth/rate_limit.py:23`)를 `main.py:235` 관례대로 두 개 등록한다:
     사용자별(키=user id, 시간당 5통)과 **전체**(키 고정, 하루 200통 — iCloud 한도 1,000통의 1/5에서
     계정 정지 전에 우리가 먼저 멈춘다). 호출 방식은 `auth/router.py:35`처럼 `request.app.state…check()`.
     초과 시 기존 `RateLimitedError`(429). 인스턴스 로컬 카운터라는 한계는 그 파일의 ponytail 주석과 같다.
   - 금액: `service.calculate_custom_amounts(session, options, quantity)`(`service.py:626`)를 그대로
     호출한다. 클라이언트가 보낸 금액을 믿지 않으며, 옵션 검증 오류(`DomainError`)도 그대로 전파된다.
   - 응답: 204. 실패는 `apps/api/src/api/errors.py`의 기존 클래스 — SMTP 실패는 `UpstreamError`(502,
     "견적서 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."), Unavailable은
     `ServiceUnavailableError`(503).
   - 로그: 사용자 id·수량·합계만. **받는 주소는 로그에 남기지 않는다**(PII).
4. **메일 본문** — 고정 템플릿. 요청에서 온 값은 **화이트리스트를 통과한 것만** 싣는다.
   - `options`는 스키마상 자유 dict(`schemas.py:38`, 10KB)다. 본문에는 api가 아는 키·값만 라벨로 바꿔
     싣고, 모르는 키와 enum 밖의 값은 **버린다**(그대로 출력 금지). 문자열 자유값은 싣지 않는다.
   - 라벨 dict는 api에 둔다. 대상 키는 store가 보내는 전부 —
     `apps/store/src/features/custom-order/model/options.ts:84-107`(`customOrderApiOptions`, 2026-11-18 기준
     18개: 원단 제공·재주문·포인트·원단 종류·디자인 종류·타이 종류·심지·사이즈·폭·봉제 옵션 7종·라벨 2종).
     표시 문구는 `packages/shared/src/order-content.ts:9`(`OPTION_LABELS`)·`:95`(`MECHANISM_LABELS`)와 같은
     값으로 맞추고, dict 위 주석에 그 파일을 적는다(실패 모드 ②).
   - 제목: `[ESSE SION] 주문 제작 예상 견적서`
   - 상단: 로고(`{settings.frontend_origin}/logo/logo-light.png` — 흰 바탕 메일이므로 B의 규칙. 주소를
     하드코딩하지 않는 이유는 도메인 전환), 발행일(`zoneinfo` `Asia/Seoul` 기준 — Cloud Run은 UTC).
     **B가 먼저 배포돼 있어야 한다**(아니면 깨진 이미지).
   - 사양 표 → 금액 표(수량, 봉제·원단·포인트, 합계 = `CustomAmountResponse` 4필드, 천 단위 콤마 + "원").
   - 고지: 부가세 문구와 유효기간 문구는 실행 조건의 운영자 답대로. 공통으로 "예상 금액이며 실제 주문
     시점의 금액이 적용됩니다." 100개 이상이면 store 문구(`custom-order/index.tsx:479`)와 같은 "100개
     이상은 담당자가 사양을 확인한 뒤 최종 견적을 안내합니다"를 더한다.
   - 하단: 주문 제작 페이지 링크(`{frontend_origin}/custom-order`), 공급자 정보(상호·대표·사업자등록번호·
     주소·전화·메일 — `app-layout.tsx:229-247` 푸터와 같은 값). `Reply-To: help@essesion.com`.
   - HTML + text/plain 대체 본문 둘 다(`EmailMessage.add_alternative`). 스타일은 인라인(메일 클라이언트가
     `<style>`을 지운다).
5. **명세·코드젠** — `docs/api-spec/domains.md` §7(견적)에 한 단락: 로그인 필수, 사용자당 시간당 5통·전체
   하루 200통, 금액은 money.md §3 계산을 서버에서 재실행, 본문은 고정 양식(요청 값은 화이트리스트만),
   실패 코드(429/502/503). 그 뒤 `pnpm codegen`으로 `packages/api-client`를 재생성해 같은 커밋에.
6. **store UI** — `apps/store/src/pages/custom-order/index.tsx`의 `actionBar`(`:493` 부근) 주 CTA 아래에
   `ActionButton variant="neutralOutline"` "견적서 메일로 받기". 주문 모드·견적 모드 둘 다 노출.
   - 활성 조건은 `priceReady`(`:423`) 하나다. 연락처·배송지 검증(`invalidCustomOrderSection`)은 주문·견적
     요청용이라 견적서 발송에는 걸지 않는다.
   - 클릭 → `requireAuth({ path: "/custom-order" })`가 거짓이면 `requestSubmit`(`:304-311`)과 같이
     `saveDraftBeforeLogin()` 후 반환(로그인 뒤 초안 복원) → 참이면 `Modal`: `TextField`(받을 주소, 기본값
     `user.email`) + "보내기"(`loading` 처리, 중복 클릭 방지).
   - 성공: 모달 닫고 `snackbar("견적서를 메일로 보냈습니다.")`. 실패: 서버 `detail`을 그대로 snackbar로
     (429·502·503 문구가 서버에 있다).
   - 페이지 규칙은 `apps/store/AGENTS.md`·`packages/shared/AGENTS.md`(Modal·TextField·ActionButton, 한 줄에
     Solid+Outline 혼용 금지 — CTA 아래 **별도 줄**에 둔다).
7. **운영 배선** — 시크릿 버전이 없는 채로 리비전이 참조하면 기동에 실패한다(`infra/README.md:31-39`).
   순서를 지킨다.
   1. `infra/variables.tf:76`의 `app_secret_ids`에 `icloud-smtp-password` 추가 → 시크릿 컨테이너만 target
      apply.
   2. 값 주입: `printf '%s' '<앱 암호>' | gcloud secrets versions add icloud-smtp-password --data-file=- …`
      (`infra/README.md:58-64`. 끝 개행 금지 — `printf '%s'`).
   3. `infra/cloudrun.tf:26`의 `api_app_secret_keys`에 `SMTP_PASSWORD = "icloud-smtp-password"` 추가,
      시크릿이 아닌 값(`SMTP_USERNAME`, 필요 시 `MAIL_FROM`)은 `production.tfvars`의 `api_extra_env`로
      (버킷 최신본을 받아 수정) → 전체 apply.
   4. `infra/README.md`의 시크릿 목록(`:65` 주석)에 한 줄 추가.
8. **테스트** — `apps/api/tests/test_estimate_email.py` 한 파일, testcontainers 규칙. 발송 확인은
   `app.state.mailer.sent`(`test_claims.py:459`의 solapi 패턴).
   ① 비로그인 401 ② 성공 204 + 메일 1통, 본문 합계 = `calculate_custom_amounts` 결과, 수신자 = 요청 주소
   ③ 6번째 요청 429 ④ `email`에 개행 → 422 ⑤ 모르는 옵션 키·임의 문자열 값이 본문에 나타나지 않는다
   ⑥ store가 보내는 18개 키 전부에 라벨이 있다(키 목록을 테스트에 적어 둔다 — 라벨 누락 방지).

## 검증

- A: `rg -n "biblecookie" apps packages` 0건. 스토어 푸터·개인정보처리방침·공지사항에서 육안 확인.
- B: store(:3000)·admin(:3001) 헤더 스크린샷 — 흰 헤더에 검정 글자만 보이고 사각형 테두리가 없어야 한다.
  모바일 폭(32px)에서 글자 획이 뭉개지지 않는지 확인. 배포 뒤 `curl -I <스토어 주소>/logo/logo-light.png` 200.
- C:
  - 로컬: SMTP 미설정으로 버튼 → 204, api 로그에 DRYRUN 한 줄(제목·합계). 비로그인으로 누르면 로그인 확인
    다이얼로그, 로그인 뒤 옵션이 복원된다.
  - `uv run pytest apps/api/tests/test_estimate_email.py`, `pnpm lint && pnpm typecheck`,
    `pnpm architecture:check`, codegen 드리프트 없음(`pnpm codegen` 후 `git status` 깨끗).
  - 운영 배포 뒤: `/readyz`(또는 capabilities 노출 지점)에서 `mailer`가 real. 운영자 계정으로 Gmail·네이버
    메일 두 곳에 발송 → 받은편지함 도착(스팸함 아님), 보낸 사람 `help@essesion.com`, 원본에
    `dkim=pass`·`dmarc=pass`, 합계가 화면 금액과 같고 로고 이미지가 보인다. 모바일 메일 앱에서 표가 깨지지
    않는지 확인.

## 되돌리는 법 / 상향 신호

- 메일 수신: iCloud Mail이 장애로 수신을 멈추면 DNS가 Cloudflare에 있으므로 MX를 다른 사업자로 바꾼다
  (TTL 3600). 사이트의 주소(`help@essesion.com`)는 그대로 둔다.
- C 끄기: `api_extra_env`의 `SMTP_USERNAME`을 비워 apply하면 Unavailable로 떨어지고 버튼은 503 문구를
  보여 준다(코드 배포 불필요). 완전히 빼려면 store의 버튼을 지운다.
- 앱 암호 유출 의심: account.apple.com에서 해당 앱 암호를 폐기하고 새로 만들어 C-7-2를 다시 한다.
- 상향 신호:
  - iCloud 발송 거부(5xx)·스팸함 도착이 반복 → 트랜잭션 메일 서비스로 교체 검토(`mailer.py`만 바꾼다).
  - 전체 하루 200통 상한에 닿음 → 남용인지(한 계정·한 수신자 반복) 정상 수요인지 로그로 구분. 남용이면
    수신자를 계정 메일로 고정, 수요면 상한 조정과 발송 수단 재검토.
  - 반송 메일(주소 오타)이 `help@` 받은편지함에 쌓임 → 모달에 주소 재확인 문구 추가.

## 기각한 대안

- **로고를 SVG `currentColor` 한 장으로**: 원본 SVG가 저장소에 없고 PNG 한 장 추가로 끝난다. 로고가 놓이는
  배경이 3종 이상으로 늘면 재론.
- **기존 `logo.png`를 `logo-dark.png`로 개명**: 이름은 대칭이 되지만 화면 참조가 없는 파일을 옮기느라
  도메인 전환 PR·외부에 퍼진 URL과 얽힌다. 어두운 배경 화면이 실제로 생겨 혼동이 나면 재론.
- **헤더에서 CSS `filter: invert()`로 반전**: 같은 파일을 두 용도로 쓰는 암묵 규칙이 생기고 메일·검색 결과
  처럼 CSS가 없는 곳에선 못 쓴다.
- **견적서를 `mailto:` 링크나 브라우저 인쇄(PDF 저장)로**: 서버 작업이 0이지만 운영자 요구가 "help@ 명의로
  보내기"라 기각. iCloud 발송이 막히면 이 안으로 후퇴한다.
- **비로그인 공개 발송**: 계산 API처럼 공개로 두면 마찰은 적지만 임의 주소로의 대량 발송 통로가 된다.
- **수신자를 계정 메일로 고정**: 가장 안전하지만 메일이 없는 소셜 계정(카카오 등)이 못 쓰고, 결재 담당자
  주소로 바로 보내려는 용도와 어긋난다. 횟수 제한 + 고정 본문으로 대신한다. 남용이 보이면 재론(상향 신호).
- **클라이언트가 계산 결과(금액)·라벨 문구를 보내고 서버는 그대로 메일**: 구현은 가장 짧지만 우리 명의
  메일에 조작된 금액·임의 문구가 실린다.
- **`email-validator` 추가(`EmailStr`)**: 의존성 하나를 들이는 값에 비해 얻는 게 형식 검사뿐이다. 실제
  도달 여부는 어차피 보내 봐야 안다.
- **Google Workspace·네이버웍스**: 월 과금. 직원이 생겨 공용 사서함·관리 콘솔이 필요해지면 재론한다.
- **Cloudflare Email Routing + Gmail 발신**: Gmail "다른 주소에서 보내기"가 2027-01에 제거된다. 재론 조건 없음.
- **Zoho Mail 무료·Purelymail(연 $10)**: iCloud+를 이미 내고 있어 추가 가입·비용이 불필요. iCloud 발송이
  거부되기 시작하면 재론한다.
