# admin UI 3건 — 대시보드 유형별 스택, 주소 검색 버튼, 타입·마감 선택 표시 (2026-09-01)

관리자 피드백 3건을 실행했다. 플랜(`docs/plans/admin-ui-dashboard-stack-and-order-options.md`)은
실행 완료로 제거했다.

## 1. 배송지 폼 "주소 검색" → "검색"

`apps/store/src/features/shipping/ui/address-form-fields.tsx` — 라벨을 `검색`으로 줄이고,
버튼을 `Box flexShrink={0}`으로 감쌌다. 라벨 축약만으로는 부족하다 — 한국어는 공백 없이도
글자 사이에서 줄바꿈되고, `ActionButton`은 `h-10` 고정이라 두 줄이 되면 글자가 버튼 밖으로
나온다. 원인은 옆 입력이 `flexGrow`라 버튼이 콘텐츠 폭 아래로 압축된 것이었다.

브라우저 실측(모달 폭 260px): 수정 후 버튼 58×40px·텍스트 rect 1개. 같은 폭에서 수정 전
조건(`주소 검색` + shrink 허용)을 재현하면 텍스트 rect 2개 — 줄바꿈이 실제로 일어났다.

## 2. 주문 상세 옵션 — 두 선택지를 모두 표시

`apps/admin/src/shared/ui/option-pair.tsx`(신규)가 2지선다의 두 선택지를 **표시 순서 고정**으로
그리고, 선택된 쪽만 `Badge variant="solid" tone="brand"`(검정 채움 + 체크), 미선택은
`variant="outline" tone="neutral"`로 그린다.

**빨간 X는 기각했다** — admin에서 빨강은 오류·클레임·파괴적 액션 시맨틱이고 미선택은 정상
상태다. 채움 대비가 같은 정보를 무해하게 전달하고, 체크 글리프가 색 이외의 채널을 준다.
처음엔 선택 배지를 `tone="neutral"`(gray-600)로 했다가 브라우저에서 보고 `brand`(#111111)로
올렸다 — 회색 채움은 미선택과 구분이 약했다.

적용 위치 — 라벨·선택지는 입력 폼(`manual-order-form.tsx`)의 SegmentedControl과 1:1로 맞췄다.
기존 `[자동] 타입·마감` 한 줄(`지퍼 · 방 · 기본`)을 폼과 같은 3행으로 쪼갠 것이다:

- `apps/admin/src/pages/orders/detail.tsx` — `[자동] 타입`·`마감`·`딤플`
- `apps/admin/src/pages/manual-orders/detail.tsx` — 같은 3행 + `[제작] 봉제`(수동/자동).
  `[제작] 마감`·`[제작] 딤플`은 **자동 봉제일 때만** 행을 낸다 — 수동이면 폼에서도 비활성이라
  선택 항목이 아니다. 한 페이지에서 두 표기법이 섞이면 개선 전보다 나빠지므로 함께 바꿨다.

접근성: 선택 여부가 채움 대비로만 보이므로 시각 라벨은 `aria-hidden`, 스크린리더에는
`"지퍼 선택됨"` / `"끈 선택 안 됨"`을 `sr-only`로 한 문장씩 준다. API 변경 없음 —
`mechanism`/`turn_knot`/`dimple`의 전체 선택지가 이미 생성 타입에 리터럴로 있다.

## 3. 대시보드 매출 추이 — 유형별 스택 막대

### API (유형 분해가 없어서 추가)

- `apps/api/src/api/domains/admin/orders.py` `dashboard_timeseries` — `orders`는
  `func.sum(total_price).filter(order_type == …)`로 5종을 한 쿼리에서 분해했다(group_by 추가 없이).
  수기 주문은 JSONB 포함 연산자 `items @> '[{"custom": {}}]'`로 주문제작 포함 여부를 판정한다 —
  빈 객체가 모든 객체에 포함되는 성질을 쓰므로 `custom: null`은 매치되지 않는다.
- `schemas.py` `DashboardTimeseriesPointOut` — 명시 필드 7종 추가(`dict`가 아니라 명시 필드:
  codegen 결과가 인덱스 시그니처가 되면 프론트 타입 안전성이 사라진다). `order_amount`는
  합계로 유지.
- **분류 7종**: 요청된 6종 + **토큰**. 토큰 주문도 매출에 합산되고 있어(`domains.md` §10)
  빼면 막대 총높이가 기존 그래프와 달라져 "매출이 줄었다"로 오독된다.
- **수기 주문은 주문 단위로 분류**한다 — 금액이 주문 단위(`amount - discount + shipping_fee`)라
  품목 배분 근거가 없다. 제작·수선이 섞이면 주문제작 수기로 센다. *제작이 통상 고액*이라는
  가정이며 실측이 아니다. "제작 수기가 과대"라는 보고가 오면 이 규칙부터 의심할 것.
- `docs/api-spec/domains.md` §10에 분해 규칙과 "7종의 합 = `order_amount`" 불변식을 적었다.
  `pnpm codegen` 결과물 동봉.

### 색 토큰 (신규)

`packages/shared/src/theme.css`에 `--color-bg-chart-1..7`, `tokens.ts` `bgRoles`에 `chart-1..7`,
값 사전(`design-token-reference.md`)과 `palette.md`에 등재했다.

상태색(critical/positive/…) 재사용은 금지했다 — 빨간 막대가 오류로 읽힌다. 값은 Claude
`dataviz` 스킬의 레퍼런스 카테고리 팔레트를 우리 표면(`#ffffff`)에 맞춰 `validate_palette.js`로
재검증해 골랐다. 레퍼런스의 light 열은 3슬롯이 3:1 미만이라 dark 열 스텝을 쓴 조합이 전 항목
통과였다: **인접쌍 CVD ΔE 8.4·정상시 19.3·대비 전 슬롯 3:1 이상.**

**한계를 그대로 적어 둔다**: `--pairs all`(임의 두 계열이 맞닿는 산점도·버블·코로플레스)은
7슬롯으로 통과하는 조합이 존재하지 않는다 — 후보 4종을 돌려봤고 전부 실패했으며, 스킬 문서도
8슬롯이 불가능하다고 명시한다. 스택 막대의 판정 기준은 인접쌍이므로 이 차트에는 적합하지만,
중간 계열이 0이면 비인접 슬롯이 맞닿는다. 그래서 범례 + 계열별 값 툴팁을 필수로 둔다.

### 프론트

`apps/admin/src/pages/dashboard.tsx` — `AMOUNT_SERIES` 7개를 같은 `stackId`로. `TrendChart`가
이미 `stackId`·자동 범례·2px 구획 spacer를 지원해서 컴포넌트 변경은 없다. 툴팁은 **0원인 유형을
빼서** 7줄로 불어나지 않게 하고 합계·주문 수를 덧붙인다. 색 슬롯은 주문 유형에 고정 —
금액 순위를 따라가면 같은 유형이 날마다 다른 색이 된다.

## 검증

- `pnpm lint` / `pnpm typecheck` / `pnpm test`(admin 241·store 244·shared 69) / `pnpm architecture:check` 통과.
- `uv run pytest apps/api/tests/test_admin_orders.py apps/api/tests/test_admin_manual_orders.py` 27건 통과.
  신규: 유형 분해 + **합 = order_amount 불변식** + 유형 필터가 분해에도 적용되는지
  (`test_dashboard_timeseries_splits_amount_by_order_type`), 수기 혼합 주문 분류
  (`test_dashboard_timeseries_splits_manual_orders_by_category`).
- admin 빌드 후 `dist/assets/*.css`에 `--color-bg-chart-1..7`과 `.gap-x1{gap:var(--spacing-x1)}`
  방출 확인 — 조용히 죽는 유틸리티가 아니다.
- 브라우저 실측(Aside, admin :3001 / store :3000): 확인용 수기 주문 3건(제작·수선·혼합)을
  만들어 스택 3구획과 툴팁(`주문제작 수기 ₩43,000 / 수선 수기 ₩12,000 / 합계 ₩55,000 / 3건`)을
  확인하고 **전부 삭제**했다(204, 잔여 0). 콘솔 오류 없음.

## 4. 수기 주문 — 제작·수선 등록 화면 분리

한 수기 주문에 주문제작과 수선이 섞이던 것을 없앴다. **API는 건드리지 않았다** —
등록 폼을 계열별로 나누면 혼합을 만들 수 있는 경로가 사라지므로, 서버 검증은 존재하지
않는 호출자를 막는 코드다(admin 전용 API, 클라이언트는 우리 화면뿐). 처음에 요청 모델에
혼합 금지 validator를 넣다가 이 지적을 받고 되돌렸다.

- `apps/admin/src/shared/lib/manual-order-kind.ts`(신규) — 계열 타입·라벨·경로 헬퍼와
  `manualOrderKind()`. 판별 규칙은 대시보드 매출 분해와 같다(주문제작 품목이 하나라도
  있으면 제작). 화면 분리 전에 섞여 저장된 주문도 이 규칙으로 한쪽에 배정된다.
- `manual-order-form.tsx` — `kind` prop이 렌더할 대분류를 정한다. 수선은 자동/폭/복원
  체크박스 3개, 제작은 대분류 자체가 없고(주문제작 하나뿐) 원단·봉제·규격이 바로 나온다.
  검증도 계열별(수선만 "대분류 하나 이상").
  **`itemBody`는 계열로 걸러내지 않고 draft를 그대로 보낸다** — 레거시 혼합 주문을
  수정할 때 다른 계열 스펙이 조용히 지워지지 않게 한다(폼은 렌더만 안 한다).
- 라우트: `manual-orders/new`·`:id`·`:id/edit`(제작) + `manual-orders/repairs/new`·
  `repairs/:id`·`repairs/:id/edit`(수선). 정적 세그먼트가 `:manualOrderId`보다 먼저
  매칭되므로 충돌이 없고, 경로가 `/manual-orders` 아래라 사이드바 활성 표시도 그대로다.
- `new.tsx`·`detail.tsx`·`edit.tsx` — 공용 본체 + 계열별 얇은 export 2개. 상세·수정은
  다른 계열 주소로 들어오면 제 화면으로 `<Navigate replace>`.
- `list.tsx` — 목록은 하나로 두고 **구분 열**(제작/수선 배지)을 넣었다. 행 링크·행 클릭이
  계열별 상세로 간다. 등록 버튼은 `수기 수선 등록`(neutralOutline) + `수기 주문 등록`(brand).
- `dashboard.tsx` 최근 수기 주문 표의 링크도 계열을 따라간다.

검증 — `new.test.tsx`를 두 describe로 재작성했다(9건): 수선 화면에 `주문제작` 체크박스가
없고 payload의 `custom`이 null, 제작 화면에 수선 대분류가 없고 `automatic`/`width`/
`restoration`이 null. 브라우저 실측: 두 화면 등록 → 각 계열 상세로 이동 확인, 잘못된 계열
주소 2방향 리다이렉트 확인, 확인용 2건 삭제 완료.

## 남은 것

- `apps/admin/src/pages/orders/detail.test.tsx:488`의 미사용 `user` 변수 경고는 이 작업과
  무관한 기존 것이다(로컬 biome 2.5.9 ↔ `biome.json` 스키마 2.5.8 드리프트). `pnpm lint`는
  exit 0이라 막지는 않는다.
- 옵션 라벨 상수가 4개 파일에 인라인 삼항으로 중복돼 있다. 선택지가 고정 2지 불리언이라
  통일하지 않았다 — 옵션 그룹이 추가되는 날 재론.
- 화면 분리 전에 제작·수선이 섞여 저장된 수기 주문은 **제작 쪽으로 배정된다**(로컬 DB에는
  0건, 운영은 확인 못 했다). 수정 시 다른 계열 스펙은 보존되지만 화면에 안 보이므로,
  운영에서 그런 행이 발견되면 두 건으로 다시 입력하는 것이 맞다. 금액이 주문 단위라
  자동 분할은 불가능하다.
