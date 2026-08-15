# admin 앱 UI 규칙

UI는 `@essesion/shared`로만 작성한다. 규칙 원본: `packages/shared/AGENTS.md` (필독).

- **우선순위 사다리**: ① shared 공통 컴포넌트(AGENTS.md 색인 표 확인) → ② 프리미티브(Box/Flex/HStack/VStack/Grid/Float)+토큰 조합 → ③ 표현 불가 시 **멈추고** shared에 토큰/컴포넌트 추가 제안. 앱 로컬 재구현·임의 값 우회 금지.
- 타이포는 Text+textStyle(admin 기본 bodySm), 아이콘은 Icon+@heroicons/react.
- 금액·수량 등 정수 입력은 `shared/ui/number-field`의 `NumberField`(천 단위 콤마 표시, 값은 콤마 없는 문자열). `type="number"`는 콤마를 못 넣으므로 쓰지 않는다 — 소수점 입력(cm 등)만 예외. 범위 검증은 화면의 JS 검증으로.
- `pnpm lint`가 하네스 정적 검사(`scripts/check-harness.mjs`)를 포함한다.

## Admin 의미 계약

### 앱 셸

- 보호 페이지의 `main`으로 이동하는 skip link와 `header`·labelled `nav`·`main` landmark를 둔다. desktop sidebar는 240px이고 현재 링크는 `aria-current="page"`를 쓴다.
- 모바일 메뉴는 키보드로 열 수 있어야 하고, 이동 후 닫히며 닫을 때 trigger로 focus를 돌린다.
- session bootstrap 전에는 보호 화면을 렌더하지 않는다. logout과 role 상실 시 access token과 query cache를 비운다.
- route마다 document title을 구분하고, 이동 후 `h1`에 `tabIndex={-1}`로 focus한다.

### 테이블·필터·페이지네이션

- data grid는 native table semantics와 `scope="col"`을 쓴다. sortable header는 하나의 button과 `th[aria-sort]`를 가지며 서버 정렬에 안정적인 `id` tie-breaker를 포함한다.
- row 전체를 클릭 가능하게 만들지 않는다. 식별자에는 명시적인 상세 link를, action에는 대상을 알 수 있는 이름을 둔다.
- 숫자·금액·수량·날짜는 tabular numbers를 쓴다. 낮은 우선순위 column을 먼저 숨기고, `min-width: 0` container에 남는 가로 overflow만 접근 가능한 이름의 `ScrollFog`로 처리한다.
- loading·최초 empty·filter empty·error·background refetch를 구분한다. stale row action을 막고 `aria-busy`와 polite live region으로 갱신을 알린다.
- pagination은 labelled `nav`와 `aria-current="page"`를 쓰고 범위 끝의 이전·다음 button을 disable한다.
- status·date·sort·page는 URL state로 둔다. 이름·email·전화번호는 component memory에만 두고 request body로 보낸다.
- filter 변경 시 page를 초기화하고 이전 request를 cancel한다. background refresh 중에는 기존 결과를 busy 상태로 유지한다.
- desktop filter는 list toolbar, mobile filter는 shared responsive modal/bottom sheet와 active-filter count를 쓴다.

### Form·mutation

- 모든 field에 visible label과 연결된 error description을 둔다. submit 실패 시 error summary와 첫 invalid field 순서로 focus한다.
- destructive/financial 변경은 `AlertDialog`에 대상·변경·영향·필수 사유를 표시하고 닫을 때 trigger로 focus를 돌린다.
- pending mutation은 중복 제출을 막는다. financial/state mutation은 자동 retry하지 않고, 수동 retry에는 같은 operation/idempotency ID를 쓴다.
- 성공 후 authoritative read model을 refetch한다. stale-write `409`는 입력을 보존하고 서버 값 비교와 명시적 reload를 제공한다.
- product·coupon·quote·pricing·settings dirty form은 route blocker와 `beforeunload`를 함께 등록한다.
- 성공과 비동기 실패는 global snackbar live region으로 알리고 reduced motion을 따른다.

### Query invalidation

| Mutation | 반드시 갱신할 query |
|---|---|
| 주문 action/tracking | 주문 detail/list, dashboard summary/recent orders, 연결 claim |
| claim action/tracking/알림 retry | claim detail/list, 주문 detail, dashboard summary, 연결 payment incident |
| payment 조정/해결 | incident detail/list, dashboard summary, 연결 주문/claim |
| customer token 조정 | customer detail/list, token ledger, operation log |
| coupon 수정/발급/회수 | coupon detail/list/history, 영향받은 customer coupon page |
| product 저장 | product detail/list, public product query |
| quote 저장/action | quote detail/list, dashboard recent quotes |
| inquiry 답변 | inquiry detail/list, dashboard summary |
| pricing/settings 일괄 저장 | 해당 complete allowlist query |

### 확인 범위

390·767·768·1024·1440 CSS px와 browser zoom 200%에서 keyboard와 화면을 확인한다. 최소 범위는 skip navigation, mobile-menu focus 복원, table keyboard 가로 scroll, sortable header, pagination, dialog 취소·완료, dirty-form 이동, error-summary focus다.
