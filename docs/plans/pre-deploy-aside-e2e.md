# 배포 전 최종 Aside E2E 검증 플랜

## 0. 목적과 판정 범위

이 문서는 배포 후보 SHA를 로컬 통합 환경에서 최종 검증하는 실행 지시서다. 브라우저
조작은 전부 Aside의 영속 Playwright REPL로 수행한다. 프로젝트에 별도 Playwright 스크립트나
브라우저 자동화 의존성을 추가하지 않는다.

이 검증은 다음 이유로 E2E 실행 게이트를 통과한다.

- 배포 직전 체크포인트다.
- 로그인·결제·주문·클레임·디자인 생성/finalize라는 핵심 사용자 경로를 다룬다.
- store/admin/API/worker/PostgreSQL/GCS 경계를 한 흐름에서 교차 확인한다.
- 과거 Aside E2E에서 발견해 수정한 회귀를 최종 후보에서 다시 판정한다.

이 문서의 PASS는 **현재 SHA가 스테이징 배포 후보가 될 수 있음**을 뜻한다. 실제
Google/Kakao OAuth, Toss sandbox, Solapi, Cloud Tasks OIDC, Cloudflare edge, Sentry와
개인정보 보존 정책은 로컬 Aside로 증명할 수 없다. 해당 항목은
`docs/OPERATOR-CHECKLIST.md`의 B~F를 별도로 통과해야 하며, 이 로컬 결과만으로 프로덕션
컷오버를 승인하지 않는다.

플랜 작성 시점의 알려진 배포 위험이 하나 있다. `apps/api/scripts/seed.py`가 옵션이 있는
`3F-SEED-001`·`3F-SEED-002`를 만들면서 `option_label`을 채우지 않고, 직전 Aside 결과도
fresh seed의 관리자 상품 저장 실패를 기록했다. B1은 이 상태를 숨기지 않고 가장 먼저
재판정하는 fail-fast gate다. 실행 전 코드가 고쳐지지 않았다면 결과는 FAIL이어야 한다.

## 1. 불변 원칙

- 브라우저 검증은 `.agents/skills/aside-browser/SKILL.md`에 따라 Aside만 사용한다.
- 상호작용과 쓰기 검증은 로컬 URL(`store :3000`, `admin :3001`, `api :8000`,
  `worker :8001`)에서만 수행한다. 프로덕션 URL에는 쓰기 요청을 보내지 않는다.
- 이미 실행 중인 서버를 먼저 확인하고, 없는 서비스만 실행한다. 실행 중인 프로세스를
  임의로 재시작하지 않는다.
- `.env`와 `.env.*`의 내용은 읽거나 출력하지 않는다. 설정 키 확인은 `.env.example`만
  사용한다.
- 실 Toss 호출은 0회, 실 Solapi 호출은 0회, GPT Image 호출은 0회를 기본 예산으로 한다.
  결제는 `테스트 결제 수단`, 알림은 로컬 DryRun만 사용한다.
- 첫 디자인 저작과 구성 수정은 OpenAI LLM 호출이 필요하다. 실행 전에 **최대 2회의 유료
  authoring 호출**을 승인받는다. 승인이 없거나 provider mode가 불명확하면 디자인 저작
  lane을 SKIP이 아닌 BLOCKED로 판정한다.
- 고정 건수보다 실행 전후의 상대 변화와 이번 실행의 고유 식별자를 대조한다. 기존 로컬
  데이터를 삭제하거나 DB를 reset하지 않는다.
- E2E 중 제품 결함이 발견되면 즉석에서 구현을 고치지 않는다. 결함을 기록하고 해당 lane을
  중단한 뒤 결과 리뷰의 조치 후보로 분류한다. 검증 종료 후 actionable finding이 있을 때만
  별도의 후속 조치 플랜을 만들며, 그 플랜에서 수정 범위와 재검증 lane을 정한다.

## 2. 검증 종료 산출물과 문서 수명주기

실행을 시작할 때 `RUN_ID=PREDEPLOY-YYYYMMDD-HHMM` 형식의 식별자를 정한다. 검증이
PASS 또는 FAIL의 종결 판정에 도달하면 아래 순서를 반드시 지킨다.

1. `docs/reviews/pre-deploy-aside-e2e-YYYY-MM-DD.md`에 실제 실행 결과를 기록한다.
2. 이 검증 플랜 `docs/plans/pre-deploy-aside-e2e.md`를 삭제한다.
3. 리뷰의 actionable finding이 1건 이상일 때만
   `docs/plans/pre-deploy-e2e-followups-YYYY-MM-DD.md`를 새로 만든다.
4. finding이 없으면 `docs/plans/`에 후속 플랜을 만들지 않는다.

결과 리뷰에는 다음 증거를 포함한다.

- 후보 SHA, 실행 시간대, 서비스 URL, viewport, provider mode와 각 lane의 판정
- 실패가 있을 때만 필요한 최소 스크린샷과 다운로드 파일 메타데이터
- store/admin의 console error·pageerror·예상하지 않은 4xx/5xx 요약
- 주문번호·클레임번호·design session/job ID 등 이번 실행의 교차 대조 키
- OpenAI authoring, GPT Image, 실 Toss, DryRun Toss, 실 Solapi, DryRun Solapi 호출 집계
- finding별 심각도, 재현 절차, 기대/실제, 영향, 배포 차단 여부와 조치 필요 여부

후속 조치 플랜은 결과를 다시 서술하는 문서가 아니다. 리뷰에서 `조치 필요`로 판정한 항목만
옮겨 다음을 적는다.

- finding ID와 review 링크
- 수정할 책임 경계와 예상 파일/도메인
- 구현 순서와 범위 밖 항목
- 유닛/통합 검증 기준
- 다시 실행할 Aside lane과 최종 합격 기준

환경 문제로 Phase A에서 시작조차 못 한 BLOCKED는 검증 완료가 아니므로 이 플랜을 유지하고
차단 원인을 해소한 뒤 재개한다. 일부 lane 실행 뒤 제품 결함으로 fail-fast 종료한 경우는
배포 FAIL 판정이 완료된 것이므로 review 작성 → 이 플랜 삭제 → 필요한 후속 플랜 생성
순서로 닫는다.

`docs/CHECKLIST.md`는 실제 완료 범위만 갱신한다. 로컬 Aside 결과로 스테이징 E2E 항목을
완료 처리하지 않는다.

## 3. Phase A — 후보 고정과 비브라우저 선행 게이트

### A1. 후보 고정

- [ ] `git status --short`로 작업 트리를 확인한다. 변경이 있으면 소유자와 범위를 결과에
  기록하고, 후보 SHA와 다른 코드가 브라우저에 서빙되지 않도록 한다.
- [ ] `git rev-parse HEAD`와 현재 브랜치를 결과 문서에 기록한다.
- [ ] 같은 SHA의 CI에서 codegen drift, lint, build, typecheck, unit/integration test,
  기존 Playwright 돈 경로/admin smoke가 PASS인지 확인한다.
- [ ] CI가 없거나 후보 SHA와 다르면 Aside를 시작하지 않고 BLOCKED로 종료한다.

### A2. 로컬 인프라와 스키마

- [ ] `lsof -i :3000`, `:3001`, `:8000`, `:8001`, `:5432`, `:4443` 또는 각 health URL로
  이미 실행 중인지 확인한다.
- [ ] DB/GCS가 없을 때만 `docker compose up -d --wait`를 실행한다.
- [ ] 애플리케이션 서버는 없는 것만 AGENTS.md의 명령으로 시작한다. 기존 서버가 다른 SHA나
  다른 설정으로 실행 중이면 임의 종료하지 말고 BLOCKED로 기록한다.
- [ ] `uv run alembic -c db/alembic.ini upgrade head`를 실행하고 repository head와 DB
  current가 일치하는지 확인한다. 직접 DDL은 실행하지 않는다.
- [ ] 아래 멱등 시드를 순서대로 실행한다.
  1. `uv run python apps/api/scripts/seed.py`
  2. `uv run python apps/worker/scripts/seed_motifs.py`
  3. `uv run python apps/worker/scripts/seed_design_examples.py`
- [ ] 유료 백필·임베딩·authoring example 시드는 이 플랜에서 실행하지 않는다. 이미 있는
  카탈로그 상태를 baseline으로 기록한다.
- [ ] `GET /healthz`, `GET /readyz`를 확인한다. 로컬에서 DB, GCS, worker가 준비 상태이고
  Toss/Solapi/finalize가 의도한 local/DryRun mode인지 기록한다.
- [ ] store 주문서에 `테스트 결제 수단`이 보이지 않거나 provider mode가 불명확하면 돈을
  쓰는 lane을 시작하지 않는다.

### A3. Aside 연결과 관측 준비

- [ ] `aside --version`, `aside account list`, `codex mcp list`로 Aside 연결과 선택 계정을
  확인한다. signed out이면 UI에서 로그인한 뒤 다시 확인한다.
- [ ] store와 admin 탭을 각각 한 번만 열고 이후 lane에서 재사용한다.
- [ ] 각 탭을 연 직후, 첫 navigation 전에 `console`, `pageerror`, 실패한 request/response를
  수집하는 listener를 연결한다. 인증값·request body·민감 query는 기록하지 않는다.
- [ ] 기본 viewport는 1440×900으로 둔다. 마지막 반응형 smoke에서만 390×844로 바꾼다.
- [ ] 구조·문구·상태 판정은 `snapshot(page)`를 기본으로 하고, 레이아웃 판정과 실패 증거에만
  `display(await page.screenshot())`를 사용한다.
- [ ] REPL 호출마다 새 변수명을 사용한다. 비밀번호를 입력한 뒤에는 password input value가
  포함될 수 있는 snapshot이나 screenshot을 만들지 않는다.

## 4. Phase B — 배포 차단 회귀 묶음

전체 도메인 시나리오보다 먼저 실행해 명확한 회귀를 빠르게 차단한다.

| ID | 경로 | 실행 | PASS 기준 |
|---|---|---|---|
| B1 | fresh seed 상품 편집 | admin 상품 목록에서 `3F-SEED-002`를 열어 옵션 묶음 이름과 옵션 재고를 확인한다. 한 옵션을 0으로 저장해 store 품절을 확인한 뒤 원래 값으로 복구한다. | `option_label` 누락으로 저장이 막히지 않고, store 품절/복구가 열린 탭에 반영된다. 원상 복구 완료. |
| B2 | admin→store focus 갱신 | admin에서 디자인 예시 한 건의 순서/게시 여부와 `design_edit_cost`를 임시 변경하고 store 탭으로 focus를 돌린다. | 전체 reload 없이 예시와 수정 단가가 갱신된다. 실제 수정 비용과 표시 비용이 일치한다. 두 설정 모두 원상 복구한다. |
| B3 | 비로그인 초안 이관 | 로그아웃 상태 `/custom-order`에서 폭·메모를 입력하고 파일 선택 또는 제출로 로그인 gate를 연 뒤 고객 로그인한다. | `/custom-order`로 복귀하고 텍스트 초안이 계정 키로 이관된다. 첨부 의도가 있었다면 재첨부 안내가 1회 보인다. |
| B4 | 결제 성공 재진입 | mock 결제로 최소 금액 주문 1건을 완료하고 success URL을 같은 탭에서 세 번 reload한다. | 매번 동일 완료 화면이며 중복 confirm은 멱등 200이다. 주문이나 결제가 중복 생성되지 않는다. |
| B5 | 업로드 중 입력 보존 | 수선 발송 사진 업로드 직후 업로드가 끝나기 전에 메모를 입력한다. | 업로드 완료 후에도 메모가 유지되고, 제출 뒤 store/admin 카드에 같은 메모가 보인다. |
| B6 | 디자인 UI 회귀 | 범위 밖 모티프 변경 문장을 제출하고 응답 직후 0.5초 간격으로 snackbar를 관찰한다. 현재 design session 삭제도 실행한다. | 토큰 순변동 0, 모티프 패널 확장·검색어 prefill·안내 snackbar가 보인다. 현재 세션 삭제 뒤 다른 세션 자동 선택이 아니라 빈 canvas가 된다. |
| B7 | 온보딩 닫힘 | 온보딩이 표시되는 신규/초기화된 테스트 상태에서 `닫기` 후 재진입하고, 별도로 `디자인 시작하기` 완료를 확인한다. | 두 닫힘 경로 모두 같은 세션에서 재노출되지 않는다. 상태 초기화가 필요하면 API/지원된 테스트 경로만 쓰며 DB 직접 수정은 금지한다. |

B1~B7 중 하나라도 FAIL이면 후속 전체 lane을 중단한다. 환경이나 테스트 데이터 부족으로
재현하지 못한 경우 PASS로 낮추지 않고 BLOCKED로 남긴다.

## 5. Phase C — 인증·상품·주문·클레임 돈 경로

### C1. 인증과 세션 경계

- [ ] 고객 계정으로 store 로그인 후 보호 페이지에 접근한다.
- [ ] 같은 브라우저의 별도 admin 탭에서 관리자 계정으로 로그인한다.
- [ ] store 세션으로 admin 보호 경로가 열리지 않고, admin logout 뒤 보호 경로가
  `/login`으로 돌아가는지 확인한다.
- [ ] 로그아웃/재로그인 뒤 헤더와 보호 페이지 상태가 다른 탭에도 일관되게 반영되는지 확인한다.

### C2. 상품 주문과 결제

- [ ] 공개 홈 인기 상품과 `/shop` 목록을 확인하고, 상품 상세에서 옵션·수량·저재고 표시를
  확인한다.
- [ ] 상품을 장바구니에 담고 옵션 변경, 수량 변경, 쿠폰 적용, 배송지 선택을 확인한다.
- [ ] mock Toss로 주문 1건을 생성한다. `RUN_ID`를 배송 메모 등 검색 가능한 비민감 필드에
  넣고 주문번호·payment group·금액을 기록한다.
- [ ] success 화면, 빈 장바구니, store 주문 상세, admin 주문 상세의 상품·옵션·금액·배송지를
  교차 대조한다.
- [ ] 동일 confirm을 한 번 재요청하거나 success URL을 reload해 결제/주문 멱등성을 확인한다.

### C3. 상태·클레임·후기

- [ ] admin에서 주문을 배송완료까지 전진시키고 store에 즉시 반영되는지 확인한다.
- [ ] 교환 또는 반품 클레임을 생성하고, 활성 클레임 동안 admin 상태 변경과 송장 수정이
  차단되며 사유 tooltip이 정확한지 확인한다.
- [ ] admin에서 클레임을 거부 또는 완료하고 store 상태와 DryRun 알림 outbox를 확인한다.
- [ ] 구매확정 전에는 후기 작성이 없고, 구매확정 뒤에만 후기 작성이 나타나는지 확인한다.
- [ ] 후기 작성 후 공개 목록과 admin 리뷰 목록에서 동일 내용을 확인한다.

### C4. 돈 경로 합격 조건

- 서버 계산 금액과 화면 금액이 동일하다.
- 주문·결제·쿠폰·재고·클레임 상태가 store/admin에서 동일하다.
- 중복 confirm이나 reload로 행·재고·원장 변화가 한 번 더 일어나지 않는다.
- 예상된 인증 401과 제품이 의도한 검증 4xx를 제외하고 4xx/5xx가 없다.
- 실 Toss 0회, DryRun/mock Toss 호출 수와 금액이 결과 문서에 기록된다.

## 6. Phase D — 디자인·토큰·worker 경계

Phase D 시작 전에 최대 2회 OpenAI authoring 호출 승인을 확인한다. 승인이 없으면 D3~D4를
BLOCKED로 판정하고 전체 배포 게이트도 PASS로 만들지 않는다.

| ID | 실행 | PASS 기준 |
|---|---|---|
| D1 | 비로그인 `/design` 진입, 게시 예시 선택 | 게시 예시가 보이고 로그인 gate가 올바르게 열린다. |
| D2 | seed 예시를 토큰 0으로 적용, 넥타이/타일 전환 | canvas와 이력 상태가 갱신되며 토큰이 차감되지 않는다. |
| D3 | 첫 디자인 저작 1회 | 성공 결과 1개, 이력 1건, 설정된 첫 생성 비용만 정확히 차감, admin seamless log에 mode·run/session·정산이 연결된다. |
| D4 | 구성 수정 1회 후 과거 step 활성화 | 수정 비용만 차감되고 step이 추가된다. 과거 step 클릭 시 intent/preview가 복원되며 새 분기나 중복 차감이 없다. |
| D5 | 카탈로그 모티프 검색·적용·교체 | 검색과 activate는 무과금이며 exact motif가 렌더와 이력에 유지된다. GPT Image 호출은 없다. |
| D6 | 범위 밖 모티프 문장 | B6과 같이 구성 수정 차감이 멱등 환불되고 패널·검색어·snackbar가 연결된다. |
| D7 | PNG export | 다운로드 성공, 파일명·MIME·0보다 큰 byte 크기를 기록한다. 내용 전체나 민감 URL은 로그에 남기지 않는다. |
| D8 | 300 DPI print finalize 1회 | local inline finalize가 성공하고 polling이 terminal success로 끝난다. 결과 이미지/공개 링크가 열리며 admin job에 입력·duration·result가 연결된다. |
| D9 | 토큰 구매·환불 1회 | mock 구매 금액·지급 원장·환불 접수·admin 승인·DryRun 취소·회수 원장이 정확히 맞는다. 사용 후 환불 불가 gate도 확인한다. |
| D10 | 현재 세션 삭제 | canvas가 빈 상태가 되고 다른 세션/완성본은 보존된다. |

추가 합격 조건:

- 첫 생성 비용, 수정 비용, 실패 환불, token purchase/refund의 산술식을 실행 전후 잔액으로
  결과 문서에 적는다.
- worker raw exception, prompt 전문, private motif ID, provider 응답 원문이 사용자 화면이나
  console에 노출되지 않는다.
- GPT Image 버튼은 남은 횟수와 비용 안내까지만 확인하고 클릭하지 않는다.
- finalize 1회 외 중복 job이 생성되지 않는다.

## 7. Phase E — 주문제작·샘플·견적·수선 대표 경로

과거 전체 조합을 다시 열거하지 않고 서비스별 경계를 가장 많이 통과하는 대표 경로만
실행한다.

### E1. 주문제작·샘플·견적

- [ ] 주문제작에서 규격 validation, 100개 경계의 즉시 주문↔견적 전환, 새로고침 초안 복원을
  확인한다.
- [ ] B3의 비로그인 초안 이관 뒤 mock 주문제작 결제 1건을 완료하고 store/admin 사양·첨부·
  금액을 대조한다.
- [ ] 디자인 완성본 1개와 업로드 첨부를 조합해 합산 제한과 소유권 gate를 확인한다.
- [ ] 샘플 주문 1건을 mock 결제하고 샘플 할인 쿠폰 자동 발급을 확인한다.
- [ ] 견적 요청 1건을 생성하고 admin에서 견적 발송→협의중→확정으로 전진시킨다. store의
  상태·금액·조건과 DryRun 알림을 대조한다.

### E2. 수선

- [ ] 수선 항목 validation, 사진 필수 분기, 장바구니의 옵션 변경 시 사진·쿠폰 보존을
  확인한다.
- [ ] 방문 수거 또는 이미 발송 경로 중 하나를 mock 결제로 완료한다. B5를 포함하려면
  `이미 발송했어요` 경로를 우선한다.
- [ ] admin에서 접수→수선중→수선완료→배송중→배송완료로 전진시키고 store 상태를 대조한다.
- [ ] company tracking 저장과 외부 배송조회 URL의 송장번호 포함을 확인하되 외부 사이트에
  개인정보를 추가 입력하지 않는다.
- [ ] success URL reload, 구매확정, 후기 노출을 확인한다.

### E3. 합격 조건

- 업로드 완료 객체만 주문 body에 포함되고, signed URL이 사용자 간에 섞이지 않는다.
- 초안·메모·첨부·쿠폰이 async upload, 로그인, route 이동에서 조용히 소실되지 않는다.
- store/admin 상태 머신과 snapshot 사양이 동일하다.
- 각 flow의 mock 결제는 한 번만 승인되고 실 provider 호출은 없다.

## 8. Phase F — 반응형·접근성·관측 smoke

### F1. 데스크톱

- [ ] 1440×900에서 store 홈, 상품 상세, 주문서, 디자인, my page와 admin 대시보드, 목록,
  상세를 snapshot으로 확인한다.
- [ ] modal/alertdialog/menu를 대표 1건씩 열어 focus 진입, Escape/취소, trigger focus 복귀를
  확인한다.
- [ ] 초기 로딩은 형태가 있는 화면에서 Skeleton, 빈/오류는 ContentPlaceholder로 구분되며
  이중 spinner가 보이지 않는지 확인한다.

### F2. 모바일

- [ ] 같은 탭을 390×844로 변경하고 store header menu, 상품 상세 CTA, 주문서, 디자인
  motif panel/modal, admin mobile menu와 대표 상세를 확인한다.
- [ ] 가로 scrollbar가 직접 노출되지 않고 필요한 곳은 ScrollFog로 탐색 가능한지 확인한다.
- [ ] modal이 모바일 하단 형태로 열리고 중첩 dialog가 생기지 않는지 확인한다.
- [ ] 버튼/입력/메뉴가 viewport 밖으로 잘리거나 고정 CTA와 겹치지 않는지 확인한다.

### F3. 오류 수집

- [ ] store/admin listener의 console error와 pageerror를 모두 확인한다.
- [ ] API/worker 로그에서 이번 `RUN_ID`, 주문번호, design run/job ID를 찾아 5xx와 예상하지
  않은 4xx가 없는지 확인한다. secret, Authorization header, prompt 원문은 결과에 복사하지
  않는다.
- [ ] 실패 request는 method·pathname·status·사용자 동작만 기록한다.
- [ ] viewport를 원래 크기로 복구하고 store/admin에서 핵심 목록을 한 번씩 reload한다.

## 9. 최종 판정 규칙

### PASS

아래 조건을 모두 만족해야 한다.

- A~F 필수 항목이 모두 PASS이며 BLOCKED가 없다.
- B1~B7 과거 회귀가 재현되지 않는다.
- 돈·토큰 산술, 주문/클레임/견적/수선 상태, design run/finalize job이 store/admin/API/worker
  사이에서 일치한다.
- console error 0건, pageerror 0건, 예상하지 않은 4xx/5xx 0건이다.
- 원상 복구 대상으로 표시한 admin setting, 상품 재고, 예시 게시/순서를 복구했다.
- 실제 외부 호출 수가 승인 예산을 넘지 않는다.

보고 한 줄:

```text
[E2E] 대상: 배포 전 Aside 최종 회귀 | 이유: 배포 직전·핵심 경로·서비스 경계 | 결과: PASS(<lane 수>) | 후보:<SHA> | 외부 호출:<집계>
```

### FAIL

다음 중 하나면 배포를 중단한다.

- 결제·토큰·쿠폰·재고가 중복 또는 불일치한다.
- 인증/인가 우회, 사용자 간 데이터 노출, 민감값 노출이 있다.
- success URL 재진입, 초안 이관, async upload, focus refetch, 디자인 환불/finalize 등 과거
  회귀가 다시 나타난다.
- console/pageerror 또는 제품 원인의 예상하지 않은 5xx가 한 건이라도 있다.
- 원상 복구에 실패해 후속 lane의 baseline을 신뢰할 수 없다.

보고 한 줄:

```text
[E2E] 대상: 배포 전 Aside 최종 회귀 | 이유: 배포 직전·핵심 경로·서비스 경계 | 결과: FAIL(<n>건) | 실패:<ID와 한 줄 요약> | 후보:<SHA>
```

### BLOCKED

CI SHA 불일치, 서버 설정 불명, migration/seed 실패, Aside sign-out, 유료 authoring 미승인,
필수 테스트 데이터 부재처럼 제품 판정을 시작할 수 없는 경우다. BLOCKED는 PASS가 아니며
환경을 바로잡은 뒤 해당 phase부터 재개한다.

## 10. 실행 후 정리

- [ ] 임시로 바꾼 상품 재고, 디자인 예시, admin setting을 baseline으로 복구한다.
- [ ] 테스트 계정에서 생성한 주문·클레임·디자인은 추적 가능하도록 결과 문서에 ID를 남긴다.
  직접 SQL이나 Alembic 밖 DDL로 삭제하지 않는다.
- [ ] 다운로드 파일은 파일명·MIME·byte 크기만 기록하고, 필요 없으면 브라우저 세션의 임시
  저장소에서 정리한다.
- [ ] store/admin logout으로 테스트 세션을 종료한다.
- [ ] `git status --short`로 E2E 증거 문서 외 예상하지 않은 변경이 없는지 확인한다.
- [ ] PASS 또는 제품 결함에 의한 FAIL이면 결과 review를 작성하고 이 검증 플랜을 삭제한다.
- [ ] review에서 `조치 필요` finding이 1건 이상일 때만 별도의 후속 조치 플랜을 작성한다.
  finding이 없으면 새 플랜을 만들지 않는다.
- [ ] 후속 플랜에는 finding별 수정 범위, 검증 기준, 재실행할 Aside lane만 포함한다. 이미
  끝난 검증 결과는 review 링크로 대체한다.
- [ ] Phase A 선행 조건 때문에 검증을 시작하지 못한 BLOCKED만 이 플랜을 유지하고 재개
  조건을 문서 상단에 기록한다.
- [ ] `docs/CHECKLIST.md`는 실제 스테이징/provider 검증 증거가 생긴 항목만 갱신한다.
