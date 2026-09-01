# admin UI 3건 — 대시보드 유형별 스택, 주소 검색 버튼, 타입·마감 선택 표시

**전제**: 2026-09-01 관리자 피드백 3건을 지시서로 정리한 것. 세 항목은 서로 독립이라
아무 순서로나 개별 실행·개별 검증할 수 있다. 아래는 난이도 오름차순.

관련 정본: `docs/api-spec/domains.md` §10(대시보드 집계 기준), `packages/shared/AGENTS.md`(디자인 시스템).

## 왜 필요한가

- **주소 검색 버튼**: store 배송지 폼에서 버튼 라벨 "주소 검색"이 좁은 폭에서 두 줄로
  꺾여 버튼이 뭉개진다(관리자 실사용 보고). 원인은 라벨 길이 + ActionButton에
  `shrink` 방지가 없는 것 — 옆의 `flexGrow` 입력이 공간을 먹으면 버튼이 콘텐츠 폭
  이하로 압축된다.
- **타입·마감 표시**: 주문 상세의 "[자동] 타입·마감" 행이 `지퍼 · 방 · 기본`처럼
  **선택된 값만** 나열한다. 각 자리가 2지선다(지퍼/끈, 방/돌려묶기, 기본/딤플)라는
  사실이 화면에 없어서, 관리자가 "기본"이 선택 결과인지 그냥 문구인지 구분하지 못한다
  (관리자 보고).
- **대시보드 매출 추이**: 막대가 단색(주문 금액 합계)이라 유형별 매출 구성이 안 보인다.
  유형 필터(`?type=`)로 하나씩 봐야 하는데, 관리자는 한 화면에서 구성비를 원한다.

## 범위 밖 (non-goals)

- 옵션 라벨 상수를 4개 파일(orders/detail, manual-orders/detail, manual-order-form,
  store reform.ts)에서 하나로 통일하는 리팩토링 — 선택지가 고정 2지 불리언이라 인라인
  중복의 비용이 낮다. 옵션 그룹이 추가되는 날 재론.
- 타입·마감 표시에서 "선택 불가"(끈 방식이면 돌려묶기 금지)와 "미선택"의 시각 구분 —
  둘 다 미선택으로 그린다. 관리자가 혼동을 보고하면 재론.
- 대시보드의 주문 **건수** 유형 분해 — 이번엔 금액 막대만.

---

## 1. 배송지 폼 "주소 검색" → "검색" + 줄바꿈 방지

- `apps/store/src/features/shipping/ui/address-form-fields.tsx:110` — 버튼 라벨을
  `검색`으로 바꾼다. (107행 스낵바 문구 "주소 검색을 불러오지 못했습니다"는 그대로 —
  버튼이 아니라 기능 설명이다.)
- 같은 파일 96행 ActionButton — 한글은 공백 없이도 글자 사이에서 줄바꿈되므로 라벨
  축약만으로는 극단 폭에서 재발한다. 버튼을 `Box flexShrink={0}`로 감싸거나 동등한
  방법으로 shrink를 막는다(`flexShrink`는 프리미티브 prop 지원 —
  `packages/shared/src/style-props.ts:101`).
- 이 폼은 `address-form-modal.tsx`·`address-select-modal.tsx` 두 모달이 공유하므로
  수정 지점은 한 곳이다.

## 2. 주문 상세 옵션 그룹 — 두 선택지를 모두 보여주고 선택을 표시

**방식**: 요청은 "선택 O(초록)/미선택 X(빨강)"였으나 **빨간 X는 기각**한다 — admin에서
빨강은 오류·클레임·파괴적 액션 시맨틱이고(`docs/foundation/color-role`), 미선택은
오류가 아니다. 대신 각 그룹의 두 선택지를 나란히 놓고:

- 선택 = `Badge variant="solid" tone="neutral"`(모노크롬 강조) + 체크 글리프,
- 미선택 = `Badge variant="outline" tone="neutral"`(흐린 외곽선).

채움 대비만으로 선택이 즉시 읽히고, 체크가 색약·인쇄에서도 구분을 보장한다. Badge는
shared 색인표의 "정적 상태 태그" 용도에 부합한다.

절차:

1. `apps/admin/src/shared/ui/`에 옵션쌍 렌더러(예: `option-pair.tsx`)를 추가한다 —
   `{ selected: string, unselected: string }`을 받아 위 Badge 쌍을 그리는 작은
   컴포넌트. admin 두 페이지에서만 쓰므로 packages/shared가 아니라 admin 로컬에 둔다
   (shared 승격은 2개 앱 이상 규칙).
2. `apps/admin/src/pages/orders/detail.tsx:113-119` — "[자동] 타입·마감" value의
   문자열 조립(`지퍼 · 방 · 기본`)을 그룹 3개의 옵션쌍 나열로 교체한다.
   `DetailItem.value`는 ReactNode라(`apps/admin/src/shared/ui/detail-list.tsx:4-7`)
   구조 변경 없이 JSX를 넣을 수 있다. 데이터는 기존 `decodeTieSpec` 결과
   (`mechanismLabel`/`turnKnot`/`dimple`) 그대로 — API 변경 없음
   (`turn_knot`/`dimple`/`mechanism` 전체 선택지가 스키마 리터럴로 이미 프론트에 있다,
   `packages/api-client/src/types.gen.ts`의 `AutomaticReform`·`ManualAutomaticSpec`).
3. `apps/admin/src/pages/manual-orders/detail.tsx:56-61` — 수기 주문 상세의 같은
   행에 동일 적용.
4. `apps/admin/src/pages/manual-orders/detail.tsx:89-97` — "[제작] 봉제"의
   `자동 · 돌려묶기|방 · 딤플|기본`도 같은 패턴이므로 함께 교체한다(자동/수동 여부는
   기존 문구 유지, 마감·딤플 쌍만 옵션쌍으로). 한 페이지 안에서 두 표기법이 섞이면
   개선 전보다 나빠진다.

## 3. 대시보드 매출 추이 — 주문 유형별 스택 막대 + 호버 툴팁

**형태**: 단색 막대 1개를 유형별 **스택 막대**로 바꾼다. `TrendChart`가 이미
`stackId`·자동 범례·툴팁을 지원하므로(`apps/admin/src/widgets/dashboard-charts/trend-chart.tsx:110-178`,
"이미지 생성" 카드가 선례) 프론트는 시리즈 배열 확장이 전부다. 호버 요구는 recharts
툴팁이 시리즈 라벨·값을 그대로 보여주므로 별도 작업이 없다.

**분류 7종**: 요청된 6종(구매·주문제작·샘플·수선·주문제작 수기·수선 수기)에 **토큰을
더한 7종**. 근거: 스택 합계가 기존 `order_amount`(전 유형 합)와 일치해야 하고, 토큰
주문도 매출에 합산되고 있다(`docs/api-spec/domains.md` §10). 토큰을 빼면 막대 총높이가
현재 그래프와 달라져 "매출이 줄었다"로 오독된다.

**API 변경 필요** — 현재 응답은 유형 구분 없는 단일 합계다.

1. `apps/api/src/api/domains/admin/orders.py:439-531` `dashboard_timeseries` —
   `orders` 쿼리에 `Order.order_type` group_by를 추가해 sale/custom/repair/sample/token
   5종을 분해한다. 수기 주문 쿼리는 JSONB `items`에 `custom` 품목이 하나라도 있으면
   `manual_custom`, 아니면 `manual_repair`로 **주문 단위** 분류해 두 버킷으로 나눈다.
   - 주문 단위 분류인 이유: 수기 주문 금액은 주문 단위(`amount - discount + shipping_fee`)라
     품목별 배분 근거가 없다. 한 주문에 제작·수선이 섞이면 제작으로 센다(제작이 통상
     고액이라는 **추정** — 실측 아님). 섞인 주문이 실제로 드물다는 것도 추정이다.
2. `apps/api/src/api/domains/admin/schemas.py:98-107` `DashboardTimeseriesPointOut` —
   유형별 금액 필드 7종을 명시 필드로 추가한다(dict 말고 명시 필드 — codegen 타입이
   깔끔하다). 기존 `order_amount`는 합계로 유지(다른 소비처 호환).
3. `docs/api-spec/domains.md` §10 대시보드 집계 기준 — 유형 분해와 수기 주문 분류
   규칙(custom 품목 존재 → manual_custom)을 명세에 추가한다(대원칙: 명세와 함께 갱신).
4. `pnpm codegen` — api-client 재생성물을 같은 커밋에(CI drift 검사).
5. 색 토큰: admin 차트는 현재 시맨틱 solid 4색만 쓴다
   (`apps/admin/src/pages/dashboard.tsx:184-187`). 7종 카테고리에 상태색
   (critical 등)을 재사용하면 빨간 막대가 오류로 읽히므로 금지. `packages/shared/src/theme.css`에
   차트 카테고리 전용 토큰(예: `--color-chart-cat-1..7`)을 추가하고
   `docs/foundation/design-token-reference.md`에 등재한다(토큰 사전 규칙). 값은
   `docs/foundation/palette` 스케일에서 명도·색상 간격이 고른 7색으로 — 인접 스택 구획이
   구분돼야 하므로 명도 차이를 확보할 것.
6. `apps/admin/src/pages/dashboard.tsx:499-519` — 매출 추이 카드 `series`를 7개
   `kind:"bar"` + 공통 `stackId`로 확장한다. 라벨: 구매·주문제작·샘플·수선·토큰·
   주문제작 수기·수선 수기. 스택 순서는 금액 비중 큰 유형을 아래에(구매·주문제작 먼저).
   기존 `?type=` 필터는 그대로 두면 해당 유형 구획만 남아 자연스럽게 동작한다.

**실패 모드**: 유형별 합 ≠ 기존 `order_amount`가 되는 것(분류 누락·중복 계상). 검증
항목의 합계 대조가 이걸 잡는다. 수기 주문 혼합 분류 규칙은 추정 기반이므로, 관리자가
"제작 수기가 과대"라고 보고하면 분류 규칙부터 의심할 것.

## 검증

- 공통: `pnpm lint && pnpm typecheck`, admin·store는 브라우저 실측(aside-browser
  하네스). 서버는 이미 떠 있는지 먼저 확인(`lsof -i :3000` 등).
- **항목 1**: store 배송지 등록 모달을 390px 폭에서 열어 버튼이 한 줄 "검색"으로
  유지되는지 확인.
- **항목 2**: admin 주문 상세(수선 주문)·수기 주문 상세에서 각 그룹에 두 선택지가
  모두 보이고 선택이 채움+체크로 구분되는지, `md` 2열 그리드에서 줄바꿈이 깨지지
  않는지 확인. 끈 방식 주문에서 돌려묶기가 미선택으로 나오는지 확인.
- **항목 3**:
  - API 테스트: `apps/api/tests/test_admin_orders.py`(timeseries 기존 테스트)에
    유형별 필드 검증을 추가하고, 혼합 품목 수기 주문의 분류 케이스를
    `test_admin_manual_orders.py` 쪽 픽스처로 커버.
    실행: `uv run pytest apps/api/tests/test_admin_orders.py apps/api/tests/test_admin_manual_orders.py`
  - 합계 불변: 임의 기간에 대해 `sum(유형별 7필드) == order_amount`를 테스트로 고정.
  - 브라우저: 대시보드 막대에 호버해 툴팁이 유형 라벨·금액을 보여주는지, 범례가
    7종으로 뜨는지 확인.

## 기각한 대안

- **미선택에 빨간 X** (원 요청): 빨강=오류 시맨틱과 충돌, 미선택은 정상 상태다.
  체크+채움 대비가 같은 정보를 무해하게 전달한다. 관리자가 그래도 X를 원하면
  `fg.neutral-muted` 회색 X로 재론.
- **수기 주문 금액의 품목 비례 배분**: 금액이 주문 단위라 배분 근거가 없고, 규칙을
  발명하면 명세가 복잡해진다. 품목 단위 금액이 생기는 날 재론.
- **`amount_by_type: dict` 스키마**: codegen 결과가 인덱스 시그니처가 되어 프론트
  타입 안전성이 사라진다. 명시 필드 7개로.
- **상태색(critical/warning 등)을 차트 카테고리로 재사용**: 빨간 막대가 오류로
  오독된다. 카테고리 전용 토큰 추가로.
- **막대 색만 바꾸고 토큰 없이 인라인 hex**: shared 하네스 규칙 2·3 위반,
  `check-harness.mjs`가 차단한다.
