# 수기 주문 송장 알림톡 + 매니저 권한 축소

두 가지를 넣는다. (A) 수기 주문에 송장을 입력하면 고객에게 배송 시작 알림톡을 보낸다.
(B) `manager` 역할을 "전체 조회 + 수기 주문 전권 + 주문 관리의 입고 확인·작업 시작"으로 줄이고
관리자 화면에 매니저 계정 관리 페이지를 만든다. A와 B는 서로 독립이라 따로 실행·머지해도 된다.
2026-11-20 작성. 카카오 템플릿 심사가 가장 오래 걸리므로 절차 A-0(템플릿 신청)을 코드보다 먼저 한다.

## 왜 필요한가

- **A.** 수기 주문(`manual_orders`)에는 송장 칸이 없다. `발송 완료`(`is_confirmed`) 체크만 있어
  전화·무통장 고객은 배송 시작을 알 수 없다. 일반 주문은 2026-09-09부터 배송중 + 송장 완비 시
  알림톡이 나간다(`docs/reviews/phone-prompt-and-shipping-alimtalk-2026-09-09.md`).
- **B.** `manager`는 DB enum과 로그인에 이미 있지만(`db/src/db/models/auth.py:12`,
  `apps/api/src/api/deps.py:25`) 권한이 `admin`과 거의 같다. 막힌 곳은 `AdminOnly` 7개 경로
  (가격·설정 저장, 결제 이상 해결 2건, 무늬 수정, 쿠폰 발급·회수 3건)뿐이고 주문 취소·롤백,
  상품·쿠폰·팝업 수정·삭제는 전부 열려 있다. 작업자에게 줄 수 있는 계정이 아니다.

## 범위 밖

- 수기 주문을 일반 주문 상태머신에 편입하지 않는다. 송장 2칸과 알림만 더한다.
- 권한 규칙을 DB 테이블이나 화면에서 편집하게 만들지 않는다. 역할은 `admin`·`manager` 둘, 규칙은
  코드 상수다. (계정 관리 화면은 만든다 — 계정만 다루고 권한은 못 바꾼다.)
- 비회원 구매(네이버페이)는 만들지 않는다. 템플릿만 비회원 공용으로 등록해 두고, 비회원 주문이
  생길 때 그 플랜에서 연결한다.
- 알림 발송 기록·발송 여부 표시는 만들지 않는다(수기 주문·일반 주문·견적 모두). 실패는 솔라피
  알림으로 받고, 미발송 원인은 고객 정보의 휴대폰 인증 여부로 확인한다. 2026-11-20에 검토 후
  뺐다 — "알림을 못 받았다"는 문의가 반복되면 재론한다.
- 계정 삭제는 없다. 비활성화만 한다 — 주문 상태 로그가 변경자를 참조한다.
- 관리자(`admin`) 계정의 추가·수정은 화면에서 하지 않는다. 기존 CLI 그대로다.

## 실행 조건

- **A-0(템플릿 신청)은 보류다. 이 문서 그대로 신청하지 않는다.** 2026-11-20에 사용자가 방향을
  바꿨다: 비회원 주문 확인 페이지로 가는 버튼을 넣고 싶은데, 승인 뒤 버튼을 바꾸면 심사를 다시
  받는다. 그래서 네이버페이 비회원 주문과 주문 확인 페이지까지 이 플랜에서 함께 설계한 뒤 템플릿
  버튼 구성을 확정한다. 아래 A-0과 "범위 밖"의 비회원 구매 항목, 결정 6은 그 보충 전의 초안이다.
  B는 이 보류와 무관하게 실행할 수 있다.

- **A의 실 발송은 카카오 템플릿 승인 뒤에만 켠다.** 코드는 승인 전에 머지해도 된다 — 템플릿 ID
  설정이 비면 발송을 건너뛴다(기존 `solapi_template_*`와 같은 규칙). 승인이 안 났으면 기다린다.
  기존 `[com] 배송 시작` 템플릿에 임의 값을 넣어 대신 보내지 않는다.
- **B는 배포 전에 운영 DB에 `manager` 계정이 이미 있는지 확인한다.** 있으면 배포 즉시 그 계정의
  쓰기 권한이 사라진다. 해당 사용자에게 알린 뒤에 배포한다.
  `select email, is_active from users where role = 'manager'`

## 확정된 결정 (2026-11-20, 사용자)

1. **매니저는 `대기중`에서 출발하는 진행을 하지 못한다.** `대기중`은 결제 전 상태이고 결제가
   끝나면 `sale → 진행중`, `custom → 접수`로 자동 전이된다(`money.md` §5). 손으로 넘기는
   `대기중 → 진행중`·`대기중 → 접수`는 결제를 건너뛰는 동작이라 관리자 전용으로 둔다.
   그래서 일반 상품(`sale`)에는 매니저가 누를 버튼이 없다.
2. **수기 주문 알림톡은 수신 동의 기록 없이 보낸다.** 수기 주문 고객은 회원이 아니라
   `notification_consent`가 없다. 배송 안내는 정보성 메시지라 동의 대상이 아니다.
3. **매니저는 송장을 입력하지 않는다.** 완성품 확인과 택배 발송은 관리자가 한다. 일반 주문의
   `제작완료`·`수선완료`·`배송중` 진행과 송장 입력은 매니저에게 닫혀 있다.
4. **매니저는 대시보드 매출과 고객 정보를 본다.** 택배를 받고 누가 보낸 것인지 확인해야 한다.
   조회는 메뉴 구분 없이 전부 연다.
5. **매니저 계정은 관리자 화면에서 만들고 관리한다.** CLI 명령은 추가하지 않는다.
6. **알림톡 템플릿은 새로 등록하고, 수기 주문 전용이 아니라 비회원 공용으로 만든다.** 곧 만들
   비회원 구매(네이버페이)에서도 같은 템플릿을 쓴다. 버튼은 `배송 조회` 1개.

## 절차 A — 수기 주문 송장 + 알림톡

0. **카카오 템플릿 신청(가장 먼저)** — 솔라피 콘솔(`console.solapi.com/kakao/templates`)에서
   기존 `[com] 배송 시작`을 본떠 신규 등록한다. 2026-11-20에 콘솔에서 확인한 기존 구성은
   헤더 `배송 시작`, 항목 3줄(주문번호·택배사·송장번호), 본문에 `#{처리유형}`, 버튼 2개
   (`배송 조회`, `주문 내역 확인`)다. 새 템플릿은 여기서 **주문번호 항목과 `주문 내역 확인`
   버튼만 뺀다** — 비회원은 주문번호가 없을 수 있고 마이페이지를 못 쓴다.
   - 이름: `[com] 비회원 배송 시작`. 채널·카테고리·강조 유형·이미지는 기존과 동일.
   - 헤더: `배송 시작`. 항목: `택배사 #{택배사}`, `송장번호 #{송장번호}`.
   - 본문: "안녕하세요, 고객님. / ESSE SION에서 접수하신 #{처리유형} 상품의 배송이
     시작되었습니다. / 배송 진행 상황은 아래에서 확인하실 수 있습니다. / 감사합니다 :)"
     (기존 본문 그대로).
   - 버튼: `배송 조회`(배송조회 유형) 1개. 콘솔 안내대로 본문·항목에 송장번호가 있어야 동작한다.
   - 변수는 `#{처리유형}`·`#{택배사}`·`#{송장번호}` 3개. 고객명은 넣지 않는다(기존도 "고객님").
   - 승인되면 템플릿 ID를 `infra/production.tfvars`의 `api_extra_env`에
     `SOLAPI_TEMPLATE_GUEST_SHIPPING_STARTED`로 넣는다(gitignore 파일 — 배포자가 직접).
     신청 문구가 위와 달라졌으면 절차 4의 변수 목록을 승인본에 맞춘다.
1. **Alembic 마이그레이션** (`db/migrations/versions/`): `manual_orders`에 `courier_company`,
   `tracking_number` (nullable text),
   `updated_by` (nullable uuid, `users.id` FK) 추가. 모델은 `db/src/db/models/commerce.py:618`.
   발송 이력 컬럼은 만들지 않는다 — 일반 주문과 같이 "송장 완비 false→true 전이"가 게이트다.
2. **설정** `apps/api/src/api/config.py:83` 아래에 `solapi_template_guest_shipping_started: str = ""`
   추가(비회원 공용 이름 — 결정 6). `required`에는 넣지 않는다. `infra/production.tfvars.example`
   주석에 `SOLAPI_TEMPLATE_GUEST_SHIPPING_STARTED` 1줄.
3. **엔드포인트** `apps/api/src/api/domains/admin/manual_orders.py`에
   `PATCH /admin/manual-orders/{id}/tracking` 추가. 본문은 `courier_company`, `tracking_number`,
   `expected_updated_at`. 같은 파일 `patch_manual_order_status`(445행)의 잠금·`stale_resource`
   패턴을 그대로 쓴다. 동작:
   - 두 값을 trim해 저장한다(빈 문자열은 NULL).
   - 저장 뒤 둘 다 채워졌으면 `is_confirmed = True`로 올린다. 송장을 지워도 내리지는 않는다
     (방문 수령 등 송장 없는 발송 완료가 있다).
   - 커밋 뒤, 완비가 이번 호출에서 false→true가 됐을 때만 알림을 보낸다. 완비 상태에서의 수정은
     재발송하지 않고, 지웠다 다시 넣으면 다시 나간다 — `orders/service.py:1179-1185`와 같은 규칙.
   - `ManualOrderOut`(204행)과 `_out`에 `courier_company`·`tracking_number`·
     `updated_by_name`을 더한다. `PUT`의 `_apply_body`는 요청 모델만
     덤프하므로 송장을 건드리지 않는다 — 요청 모델에 송장 필드를 넣지 말 것.
3-1. **수정자 기록** — 같은 파일의 등록·수정·상태·송장 4개 라우트에서 `row.updated_by = admin.id`.
   `updated_by_name`은 조회 시 `users.name`을 조인해 채운다(없으면 null). 이력 테이블은 만들지
   않는다 — 마지막 수정자 1명만 남긴다.
4. **발송 함수**는 같은 파일에 둔다. `orders/service.py:1288`의 `_send_order_alimtalk`는 회원
   4조건을 확인하므로 재사용하지 않는다. 형태만 따른다: 템플릿 설정이 비면 return,
   `BackgroundTasks`로 응답 뒤 발송, 예외·실패는 로그만. 수신 번호는 `row.phone`
   (`normalize_mobile_phone`으로 이미 정규화돼 있다). 변수는 `#{처리유형}`·`#{택배사}`·`#{송장번호}`.
   `#{처리유형}`은 품목에서 정한다: 전부 `custom`이면 `주문 제작`, `custom`이 하나도 없으면
   `수선`, 섞였으면 `주문` — 문구는 `orders/service.py:1197` `SHIPPING_KIND_LABEL`의 값과 맞춘다.
   대체 문자는 `SHIPPING_STARTED_FALLBACK`(같은 파일 1189행)에서 주문번호 줄과 마이페이지 링크를
   뺀 형태로 따로 둔다.
5. **admin 화면** `apps/admin/src/pages/manual-orders/detail.tsx`: 액션 줄(324행 부근)에 `송장 입력`
   버튼과 다이얼로그(택배사 선택 + 송장번호). 택배사 목록은 `orders/detail.tsx:103`의
   `courierOptions`를 `shared/lib`로 옮겨 두 화면이 같이 쓴다(값은 택배사 이름 그대로 —
   알림톡 변수에 그대로 들어간다). 기본 택배사는 `default_courier_company` 설정. 상세 정보에
   택배사·송장번호·마지막 수정자 표시. 목록(`list.tsx`)은 바꾸지 않는다.
6. **명세** `docs/api-spec/domains.md:87` 아래에 송장 저장 규칙·발송 조건·템플릿 fallback 추가.
   `pnpm codegen`으로 api-client 재생성.
7. **테스트** `apps/api/tests/test_admin_manual_orders.py`: 송장 완비 → 1회 발송 + `is_confirmed`,
   수정자 기록, `#{처리유형}` 3가지(주문 제작·수선·섞임), 완비 상태 수정 → 미재발송, 택배사만 입력 → 미발송, 템플릿 미설정 → 미발송, `stale_resource`.
   admin `detail.test.tsx`에 다이얼로그 저장 1건.

## 절차 B — 매니저 권한

원칙은 **기본 거부**다. 매니저의 변경 요청은 전부 403이고, 열어줄 경로만 표시한다. 나중에
다른 메뉴 권한을 열 때는 해당 라우트의 의존성 한 단어만 바꾼다.

1. **의존성** `apps/api/src/api/deps.py:106` `get_admin_user`에 `request: Request`를 받아,
   `role == "manager"`이고 메서드가 `MUTATING_METHODS`(26행)면
   `ForbiddenError(code="manager_read_only")`. 같은 파일에 기존 동작(역할 둘 다, 모든 메서드)을
   하는 `get_admin_staff` / `AdminStaff`를 새로 둔다. `AdminOnly`는 그대로.
2. **매니저에게 여는 라우트**를 `AdminUser → AdminStaff`로 바꾼다.
   - 수기 주문 전부: `admin/manual_orders.py`의 모든 라우트(절차 A-3의 송장 포함).
   - POST지만 조회인 것: 서명 읽기 URL 3건(`admin/router.py:163`, `admin/entity_images.py:53`,
     `admin/quotes.py:300`), 검색 2건(`admin/inquiries.py:252`, `admin/customers.py:205`),
     쿠폰 대상 미리보기(`admin/coupons.py:417`). 안 열면 매니저 화면에서 사진·검색이 깨진다.
   - 주문 상태 변경: `orders/router.py:401` (세부 제한은 4번).
   - 실행 시점에 `grep -rn "AdminUser" apps/api/src`로 POST/PUT/PATCH/DELETE 라우트를 다시 훑어
     위 목록에서 빠진 "조회성 POST"가 없는지 확인한다. 이 표는 2026-11-20 기준이다.
3. **닫힌 채로 두는 것**(바꾸지 않음, 자동 403): 주문 송장(`orders/router.py:424`), 클레임 상태·송장,
   견적 상태, 문의 답변, 후기 삭제, 상품·쿠폰·팝업·템플릿 등록·수정·삭제, 결제 대사.
4. **주문 상태 제한** `apps/api/src/api/domains/orders/service.py:1082` `admin_update_status`:
   `admin.role == "manager"`이면 `is_rollback`이 참이거나 `(order_type, 현재 상태, new_status)`가
   아래 허용 전이 밖일 때 `ForbiddenError`. 현재 상태를 봐야 하므로 검사는 주문을 잠가 읽은 뒤
   (`validate_transition` 호출 직전)에 둔다. 상수는 `orders/status_machine.py`에
   `MANAGER_FORWARD`로, `FORWARD`와 같은 모양으로 둔다. 취소는 `new_status == "취소"`라 같은
   검사로 막힌다.
   - `repair`: `발송대기`·`발송중`·`발송확인중 → 접수`(입고 확인), `접수 → 수선중`
   - `custom`·`sample`: `접수 → 제작중`
   - `sale`: 없음
5. **버튼 상태** `apps/api/src/api/domains/admin/orders.py:223` `_admin_actions`에 `actor_role`을
   넘겨, 매니저에게 금지된 액션은 `enabled=False`, `blocking_reason="권한이 없습니다"`로 내린다.
   `payment_incidents.py:154`의 `_actions(actor_role=...)`가 같은 패턴이다. 주문 상세 화면은
   이미 `enabled`·`blocking_reason`을 그리므로 프론트 수정이 없다. `actor_role`은
   `admin/router.py`의 주문 목록·상세 라우트에서 `order_queries.list_orders`·`get_order_detail`을
   거쳐 내려보낸다.
6. **admin 프론트 — 나머지 메뉴**: 서버가 정본이고 화면은 표시만 맞춘다.
   - `apps/admin/src/shared/session/`에 `useCanWrite(menuKey)` 하나 추가. `admin`이면 참,
     `manager`면 `menuKey === "manual-orders"`일 때만 참. `pricing.tsx:143`·`settings.tsx:100`의
     `role === "admin"` 판정도 이걸로 바꾼다.
   - 등록·수정 라우트(`/products/new`, `/coupons/:id/edit`, `/popups/new` 등, 수기 주문 제외)는
     `apps/admin/src/app/router/router.tsx`에서 `ProtectedRoute allowedRoles={["admin"]}`로 감싼다
     (`protected-route.tsx:69`가 이미 지원).
   - 목록·상세의 등록·수정·삭제·상태변경 버튼은 `useCanWrite`가 거짓이면 렌더하지 않는다.
     대상 페이지: products, coupons, popups, quotes, claims, incidents, inquiries, reviews,
     customers, motifs, design-examples. 안내 문구는 넣지 않는다.
7. **매니저 계정 관리 API** — `apps/api/src/api/domains/admin/staff.py` 신규, 전부 `AdminOnly`.
   대상은 `role == "manager"` 행뿐이다. `admin` 계정 id로 부르면 404.
   - `GET /admin/staff` 목록(이메일·이름·활성 여부·생성일).
   - `POST /admin/staff` 생성(이메일·이름·비밀번호). 검증은 `auth/admin_ops.py:16`
     `_validate_credentials`(12자 이상) 재사용, 이메일 중복 409.
   - `PATCH /admin/staff/{id}` 이름·`is_active` 변경. 비활성화하면
     `revoke_all_refresh_tokens`를 부른다. access token은 `deps.py:55`가 요청마다 `is_active`를
     확인하므로 즉시 막힌다.
   - `POST /admin/staff/{id}/password` 비밀번호 재설정 + 세션 폐기
     (`admin_ops.py:51` `reset_admin_password`의 본문을 id 기준으로 재사용). 이미 발급된 access
     token은 최대 15분 남는다 — 즉시 끊으려면 비활성화한다.
   - `main.py:341` `_include_routers`에 등록.
7-1. **매니저 계정 관리 화면** — `apps/admin/src/pages/staff/` 목록 + 등록·비밀번호 재설정·
   활성 전환 다이얼로그. 라우트는 `ProtectedRoute allowedRoles={["admin"]}`.
   `shared/config/navigation.ts`의 `시스템` 그룹에 `계정 관리`를 추가하고, `AdminNavigationItem`에
   선택 필드 `roles`를 둬 매니저에게는 이 메뉴를 그리지 않는다. 비밀번호는 관리자가 직접 입력하고
   화면에 다시 보여주지 않는다.
7-2. **로컬 시드** `apps/api/scripts/seed.py:446` 부근에 `manager@local` / `manager-local-password`
   (역할 `manager`)를 추가하고 파일 머리 주석의 계정 목록에도 적는다. 운영 계정은 배포 뒤
   관리자가 7-1 화면에서 만든다.
8. **명세**: `docs/api-spec/domains.md:34` 아래에 역할별 권한 표(매니저 = 조회 + 수기 주문 +
   절차 4의 허용 전이), `money.md §8`에 매니저 전이 제한 1줄, `ARCHITECTURE.md:280`의
   "admin/manager capability에 따라"에 이 표 링크. `pnpm codegen`.
9. **테스트** (testcontainers, mock 금지):
   - `apps/api/tests/test_authz.py`: 앱의 `/admin` 라우트 중 변경 메서드를 전부 순회해 매니저
     토큰이 403인지, 허용 목록만 403이 아닌지 확인한다. 새 라우트가 실수로 열리는 것을 이
     테스트가 막는다.
   - `test_admin_orders.py`: 매니저 → 수선 입고 확인·`접수 → 수선중`·`접수 → 제작중` 성공,
     `대기중 → 접수`(custom)·`대기중 → 진행중`(sale)·롤백·취소·배송중·송장 403,
     상세 응답의 `admin_actions` 비활성.
   - `test_admin_manual_orders.py`: 매니저 CRUD·송장 성공.
   - `test_admin_management.py`: 계정 관리 4개 경로 — 매니저 호출 403, `admin` 계정 대상 404,
     비활성화된 매니저의 기존 토큰 401·재로그인 거부, 비밀번호 재설정 뒤 새 비밀번호로 로그인.
   - admin: `router.test.tsx`에 매니저의 `/products/new` 차단 1건.

## 검증

- `uv run pytest apps/api/tests/test_authz.py apps/api/tests/test_admin_orders.py apps/api/tests/test_admin_manual_orders.py apps/api/tests/test_admin_management.py`
- `uv run ruff check . && uv run pyright`, `pnpm lint && pnpm typecheck && pnpm test`,
  `pnpm architecture:check`, `pnpm codegen` 뒤 diff 없음.
- 로컬에서 매니저로 로그인해 확인: 모든 메뉴 열림 / 수기 주문 등록·수정·삭제·송장 가능 /
  주문 상세에서 절차 B-4의 허용 전이만 활성(결제 전 `대기중` 주문과 일반 상품은 전부 비활성),
  롤백·취소·송장 비활성 / 상품 등 다른 메뉴에 변경
  버튼 없음 / `계정 관리` 메뉴가 안 보이고 주소로 들어가도 차단.
- 관리자로 `계정 관리`에서 매니저를 만들고 → 그 계정으로 로그인 → 비활성화 → 즉시 튕기는지.
- A 실 발송: 템플릿 승인 뒤 production에서 본인 번호로 수기 주문 1건을 만들어 송장 입력 →
  알림톡 수신, 변수 3개 치환, `배송 조회` 버튼을 눌러 카카오 배송 조회 화면이 뜨는지 확인.
  버튼이 택배사를 인식하지 못하면 관리자 택배사 목록의 이름을 카카오 인식 이름에 맞춘다.

## 되돌리는 법

- A: 템플릿 환경변수를 비우면 발송만 꺼진다. 컬럼은 남겨도 무해하다.
- B: `deps.py`의 매니저 검사 한 블록을 지우면 이전 권한으로 돌아간다. 되돌릴 신호는 매니저가
  조회 화면에서 403을 만나는 경우(사진·검색·미리보기) — 절차 B-2의 조회성 POST 누락이다. 이때는
  되돌리지 말고 그 라우트를 `AdminStaff`로 바꾼다.

## 실패 모드

- B의 실패 모드는 **조회성 POST를 빠뜨려 매니저 화면이 깨지는 것**과 **프론트만 가리고 서버를 안
  막는 것**이다. 전자는 B-2 재확인, 후자는 B-9 순회 테스트가 잡는다.
- A의 실패 모드는 템플릿 변수명이 승인본과 달라 알림톡이 실패하고 대체 문자로만 나가는 것이다.
  실 발송 1건으로만 드러난다.

## 기각한 대안

- **기존 `[com] 배송 시작` 템플릿 재사용** — 주문번호 항목이 고정이라 수기 주문은 채울 값이 없고,
  `주문 내역 확인` 버튼이 비회원에게 로그인 화면을 띄운다(2026-11-20 콘솔 확인). 재론 없음.
- **수기 주문 전용 템플릿** — 곧 비회원 구매가 생기면 심사를 한 번 더 받아야 한다. 비회원 공용
  하나로 등록한다. 비회원 주문에 주문번호·조회 화면이 생겨 문구가 달라져야 하면 그때 따로 만든다.
- **권한 테이블 + 관리 화면** — 역할이 둘이고 규칙이 한 줄씩이다. 역할이 3개 이상이 되거나
  계정별로 다른 권한이 필요해지면 재론. (계정 관리 화면은 만들되 권한은 역할 고정이다.)
- **프론트에서만 버튼 숨김** — API를 직접 부르면 뚫린다.
- **라우트마다 허용 역할을 적는 방식(기본 허용)** — 새 라우트를 만들 때 빠뜨리면 매니저에게
  열린다. 기본 거부가 반대 방향으로 실패한다.
- **수기 주문을 주문 상태머신에 편입** — 결제·클레임 경로까지 따라온다. 송장 2칸으로 충분하다.
