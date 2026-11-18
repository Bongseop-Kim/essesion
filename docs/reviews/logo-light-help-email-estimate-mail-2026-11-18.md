# 로고 밝은 배경용 추가 · 대표 메일 교체 · 견적서 메일 — 실행 결과 (2026-11-18)

`docs/plans/logo-variants-help-email-estimate-mail.md`의 A·B·C와 운영 SMTP 배선을 실행했다. 배포 뒤 확인과
운영자 결정 세 가지는 플랜에 남아 있다.

## 한 일

- **A. 대표 메일**: 스토어 푸터, 개인정보처리방침의 보호책임자 메일, `packages/shared/AGENTS.md`의 사업자
  표기를 `help@essesion.com`으로 바꿨다. 방침의 시행일을 2026-11-18로 고치고 공지사항에 "개인정보
  보호책임자 연락처 변경 안내"를 추가했다(방침 10조가 변경 시 공지를 약속한다).
- **B. 로고**: `logo.png`의 RGB를 반전한 `logo-light.png`(흰 바탕·검정 글자)를 store·admin `public/logo/`에
  넣고 두 헤더와 홈 구조화 데이터의 로고 파일명을 바꿨다. 기존 `logo.png`는 어두운 배경용으로 남겼다.
  규칙 한 줄을 `packages/shared/AGENTS.md`에 적었다.
- **C. 견적서 메일(코드)**:
  - `POST /orders/custom/estimate-email` — 로그인 필수, 금액은 서버 재계산, 사용자당 시간당 5통·전체 하루
    200통. 계약은 `docs/api-spec/domains.md` §7.
  - `apps/api/src/api/integrations/mailer.py` — smtplib, Real/DryRun/Unavailable.
  - `apps/api/src/api/domains/orders/estimate.py` — 견적서 엑셀과 메일 본문.
  - store: 주문 제작 화면 CTA 아래 "견적서 메일로 받기" 버튼과 입력 창
    (`apps/store/src/features/custom-order/ui/estimate-email-modal.tsx`).
  - 의존성 `xlsxwriter` 추가(api), api-client 재생성.

- **운영 SMTP 배선**: 시크릿 `icloud-smtp-password`를 만들고(컨테이너만 target apply → 운영자가 gcloud로 값
  주입 → 전체 apply) api에 `SMTP_PASSWORD`(시크릿 참조)·`SMTP_USERNAME`을 넣었다. plan은 api 환경값 2개 추가와
  시크릿 접근 권한 1건뿐이었다. 적용 뒤 리비전 `api-00050-s9q`가 트래픽 100%를 받고 `/readyz`는 ready.
  `production.tfvars`는 버킷 최신본을 받아 고친 뒤 다시 올렸다. 앱 암호는 발신 테스트에 쓴 것을 그대로 썼다.
  이 시점의 운영 api는 견적서 메일 코드가 없어 이 값을 쓰지 않는다 — 코드가 배포되면 `mailer`가 real이 된다.

## 플랜과 달라진 것 (2026-11-18 운영자 결정)

- **견적서는 메일 본문이 아니라 엑셀 첨부다.** 거래처가 결재에 쓰는 문서는 파일이어야 한다는 운영자 판단.
  메일 본문은 고정 인사말과 합계 한 줄이다. 그래서 메일에 로고 이미지가 없고 B와의 배포 순서 의존도 없다.
- **양식은 운영자가 쓰던 수기 견적서(2026-11-12 발행분)를 따랐다.** 시안 3종(클래식 격자·검정 띠·미니멀)
  중 클래식을 골랐다. 구성: 제목, 발행일·수신·공급자 표, 합계 금액, 품목표(No·품목·소재·수량·단가·
  공급가액·세액)와 여백 4줄, 계·합계, 제작 사양, 세금계산서 입금 계좌. 안내 문구와 로고는 뺐다.
- **수신 업체명을 받는다.** 플랜은 고객 입력 문구를 싣지 않기로 했으나 수기 견적서에 "○○ 귀하"가 있다.
  글자 종류를 좁힌 40자 한 칸만 받는다(계약은 명세). 엑셀 생성기는 `strings_to_formulas`를 꺼서 `=`로
  시작하는 문자열도 수식이 되지 않는다.
- **부가세**: 수기 견적서가 합계 1,610,000원을 공급가액 1,463,636 + 세액 146,364로 나눈 것을 근거로 화면
  금액을 부가세 포함으로 보았다. 운영자의 명시적 확인은 아직 없다(플랜의 남은 확인).
- **유효기간 문구**: 수기 견적서에 없어 넣지 않았다.
- 글꼴은 `Arial`로 지정했다. `맑은 고딕`을 지정하면 그 글꼴이 없는 맥 미리보기에서 명조로 떨어지고,
  라틴 산세리프를 지정하면 윈도우·맥 모두 시스템 고딕으로 이어졌다(맥 Quick Look으로 확인, 윈도우
  엑셀은 미확인).

## 확인한 것

- `uv run pytest apps/api/tests/test_estimate_email.py -k "not estimate_email_"` 17건 통과 — 옵션 라벨,
  모르는 키·값 버리기, 부가세 분할, 엑셀 내용, 수식 미생성, 메일 주소·업체명 검증.
- store: `estimate-email-modal.test.tsx` 2건, 주문 제작 페이지·공지 테스트 통과. `pnpm lint`,
  `pnpm architecture:check`, store `typecheck`, `ruff check`, `pyright` 통과.
- 메일 기반(2026-11-18 실측): `help@essesion.com` 수신, `smtp.mail.me.com:587` 발신, Gmail 원본에서
  `dkim=pass header.i=@essesion.com`·`spf=pass`·`dmarc=pass`. SMTP 로그인 아이디는 계정의 `@icloud.com`
  주소이고 암호는 앱 암호다(Apple 계정 로그인 주소는 550, 계정 비밀번호는 535로 거절).

## 확인하지 못한 것

- **엔드포인트 테스트 3건**(비로그인 401, 재계산 금액으로 발송, 6번째 요청 429)은 실제 Postgres가 필요한데
  로컬 Docker가 꺼져 있어 돌리지 않았다. CI가 돌린다.
- 화면 실측(헤더 로고, 버튼·입력 창)과 실제 메일 수신. 서버를 띄우지 않았다.
- 윈도우 엑셀·모바일 메일 앱에서의 견적서 모양.
