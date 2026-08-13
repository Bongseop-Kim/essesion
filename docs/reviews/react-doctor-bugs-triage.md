# React Doctor Bugs 경고 트리아지

React Doctor 0.9.11의 `Bugs` 분류 60건을 실제 코드와 호출 경로로 검토했다. 경고 수는 결함 수가
아니다. 같은 effect의 여러 state 변경이 각각 집계되고, 성능·유지보수 권고도 `Bugs`에 포함된다.

## 결론

| 판정 | 진단 수 | 의미 |
|---|---:|---|
| 수정 완료 | 4 | render side effect, 비동기 race, 불안정한 목록 identity |
| UX 재현 후보 | 9 | 열린 모달에서 effect가 이전 초안을 다음 paint에 초기화할 가능성 |
| 결함 아님 | 47 | 명시적 reset·비동기 상태 머신·정적 목록·성능/구조 권고·도구 오탐 |

## 수정 완료

4건을 모두 상환하고 회귀 테스트를 추가했다. React Doctor 전체 결과는 190건에서 183건으로,
`Bugs` 분류는 60건에서 56건으로 줄었고 신규 finding은 0건이다.

### render 중 object URL 생성 — 2건

- `apps/store/src/pages/custom-order/index.tsx`
- `apps/store/src/pages/sample-order/index.tsx`

파일 선택 시 URL resource를 한 번 만들고 파일 제거 또는 화면 unmount 때 같은 URL을 해제하는
`useFilePreviews` 훅으로 통합했다. 분석기가 hook action 사이의 revoke callback을 추적하지 못하는 위치는
해제 경로를 명시한 inline suppression을 남겼다.

### 결제 위젯 초기 금액 race — 1건

- `apps/store/src/features/checkout/ui/payment-widget.tsx`

초기 렌더가 끝난 뒤 `amountRef`와 마지막 SDK 반영 금액이 같아질 때까지 동기화하고, 그 뒤에만
`ready=true`를 연다. 초기화 중 금액 변경을 재현하는 deferred SDK 테스트를 추가했다.

### 편집 목록의 index key — 1건

- `apps/admin/src/pages/manual-orders/manual-order-form.tsx`

`ItemDraft`에 UI 전용 stable ID를 추가하고 API body에서는 제외했다. 앞 품목 삭제 뒤에도 뒤 품목의
입력 DOM identity와 값이 유지되는 테스트를 추가했다.

## UX 재현 후 수정 후보

다음 컴포넌트는 닫혀 있는 동안 이전 초안을 보존하고, `open=true` render 뒤 effect에서 새 초안으로
바꾼다. 빠른 브라우저에서는 보이지 않을 수 있지만 다른 대상 재개방 시 이전 값이 한 paint 노출되는지
확인한다.

| 컴포넌트 | 진단 수 | 확인할 경로 |
|---|---:|---|
| inquiry form modal | 3 | 문의 A를 닫고 문의 B 또는 신규 문의 열기 |
| phone verify modal | 2 | 기존 번호·인증코드 입력 뒤 닫고 재개방 |
| bulk apply modal | 1 | 다른 넥타이 설정으로 연속 개방 |
| review form modal | 3 | 후기 A 편집 뒤 후기 B 또는 신규 후기 열기 |

재현되면 부모에서 대상 ID를 `key`로 사용해 새 인스턴스를 만들거나, 열기 전에 초기 state가 확정되는
구조로 바꾼다. effect를 `useLayoutEffect`로 바꾸는 것은 근본 해결로 사용하지 않는다.

## 결함이 아닌 진단

| 규칙 | 건수 | 판정 근거 |
|---|---:|---|
| `no-adjust-state-on-prop-change` | 18 | admin 저장 후 `resetSignal`, 닫힐 때 초기화, async job 종결, 주소 기본값 동기화 등 명시적 상태 전이 |
| `no-derived-state` | 6 | `baseDraft`·`baseRevision`은 현재 prop의 파생값이 아니라 dirty/낙관적 잠금용 제출 기준 snapshot |
| `prefer-useReducer` | 6 | reducer 선호는 구조 권고이며 현재 상태 불일치 증거가 없음 |
| `no-array-index-as-key` | 4 | 서버 결과·정책 문구·상세 이미지처럼 재정렬되지 않는 표시 전용 목록 |
| `no-reset-all-state-on-prop-change` | 3 | 검색 resetKey 또는 닫혀 숨은 popover/onboarding 초기화 |
| `exhaustive-deps` | 2 | cart `coupons`, reform `ties`가 매 render 새 참조라 memo가 무효일 뿐 결과는 최신이며 정확함 |
| `no-effect-chain` | 2 | 후기 조회값 복원과 상품 옵션별 수량 초기화의 명시적 순서; 추가 render 외 오동작 증거 없음 |
| `no-pass-live-state-to-parent` | 2 | 결제 ready와 업로드 pending을 부모 action gate에 전달하는 의도적 계약 |
| `no-prop-callback-in-effect` | 1 | 위 결제 ready 계약과 같은 위치의 중복 진단 |
| `no-loading-flag-reset-outside-finally` | 1 | 실제 구현이 이미 `finally`에서 sequence를 확인하고 loading을 해제함 |
| `no-unguarded-throwing-parse-call` | 1 | E2E 전용 분기이며 URL은 내부 코드가 `window.location.origin`으로 만든 절대 URL |
| `query-mutation-missing-invalidation` | 1 | mutation이 서버 변경이 아니라 1회성 signed read URL 조회이고 local state에 결과를 저장함 |

합계: 47건.

## 실행 결과

1. object URL render side effect 2건 수정 및 cleanup 테스트 완료.
2. 결제 금액 초기화 race 수정 및 SDK deferred 테스트 완료.
3. 수기 주문 품목 stable UI ID와 중간 삭제 테스트 완료.
4. 모달 4종은 브라우저에서 연속 개방 경로를 재현한 항목만 후속 수정한다.

관련 Vitest, admin/store 타입체크, 저장소 lint와 전체 GC 센서를 통과했다. mock Toss를 사용하는
Playwright 주문·결제 경로도 1건 통과했다(실 Toss 호출 0회).
