# store 주문·클레임 후속 개선(C9 팔로업) 플랜

> `docs/plans/store-order-claim.md` §10 이연 항목 중 2건을 실행한다. YeongSeon 원본 대비 파리티 검증(2026-07-11)에서 확인된 실질 공백이다.
> 원본 참고(복사 금지): `../git/YeongSeon/apps/store/src/features/order/components/token-refund-action.tsx`, 배송지 스냅샷은 원본에도 없던 개선(커머스 관례).

## 1. 토큰 환불 신청 플로우 배선 (프론트 전용)

**문제**: api에 `GET /tokens/refundable-orders`·`POST /tokens/refund-requests`·`POST /tokens/refund-requests/{claim_id}/cancel`이 완비되어 있고 api-client 생성물(`listRefundableTokenOrdersOptions`·`requestTokenRefundMutation`·`cancelTokenRefundMutation`)도 존재하지만 store가 아무것도 호출하지 않는다. 토큰 구매(C7)는 열려 있는데 고객이 환불을 신청할 방법이 없다.

**원본 명세 보존**: YeongSeon은 주문 목록 카드에서 `TokenRefundAction` 6분기(신청 중/환불 완료/처리 중/신청 가능/토큰 사용됨/유료토큰 없음)를 제공했다. essesion은 D2(액션은 상세에서만)에 따라 **주문 상세**에 배치하고, 분기는 서버 `RefundableTokenOrder.reason`(`expired|pending_refund|approved_refund|not_latest|tokens_used`) + `is_refundable`을 그대로 신뢰한다 — 프론트 자격 재계산 없음(C9 D3와 동일한 결).

**설계**:

- `features/claims/ui/token-refund-section.tsx` (신규): `order_type === "token"`인 주문 상세에서 렌더.
  - `listRefundableTokenOrdersOptions()` 조회 후 `order_id`로 해당 행 탐색. 행 없음(완료 전·취소 주문) → 섹션 미표시.
  - `is_refundable` → 안내(회수 토큰 수·환불 금액) + "환불 신청" `ActionButton` → `AlertDialog` 확인(구매확정과 동일한 D7 결) → `requestTokenRefundMutation`.
  - `reason` 분기: `pending_refund` → `Callout`(informative, 클레임 내역으로 이동 actionable) / `approved_refund` → positive / `tokens_used`·`not_latest`·`expired`·유료토큰 없음 → neutral 불가 사유 문구.
  - 로딩 `Skeleton`, 조회 실패 `Callout` neutral + 재시도.
- 클레임 상세(`pages/my-page/claim-detail.tsx`): `token_refund` + `접수`에서 숨겨져 있던 "신청 취소"를 `cancelTokenRefundMutation`으로 배선. cancel/return/exchange의 DELETE(레코드 삭제)와 달리 token_refund 취소는 상태가 `거부`로 전이되므로 다이얼로그·스낵바 문구를 분리한다.
- 캐시: 신청/취소 성공 시 `listRefundableTokenOrdersQueryKey` + `listMyClaimsQueryKey` + `getOrderQueryKey(주문)` + `listMyOrdersQueryKey` invalidate.
- api 스펙 변경 없음 — codegen 불필요. `RefundableTokenOrder`에 `claim_id`가 없어 주문 상세에서 직접 취소는 불가하지만, 취소 진입점을 클레임 상세로 통일(다른 클레임 타입과 동일 위치)해 계약 변경 없이 해결.

## 2. 주문 배송지 스냅샷 (db + api, 스펙 변경 없음)

**문제**: `orders.shipping_address_id`가 라이브 FK(`SET NULL`) — 고객이 주소를 수정하면 과거 주문 상세의 배송지 표시가 바뀌고, 삭제하면 유실된다. 커머스 관례는 주문 시점 스냅샷.

**설계**:

- `orders.shipping_address_snapshot` JSONB nullable 컬럼 추가(Alembic 신규 리비전). 백필: 기존 주문을 `shipping_addresses` 조인 값으로 채움(현재 라이브 조인과 동일한 결과라 손실 없음).
- 주문 생성 3경로(`create_order`/`create_custom_order`/`create_sample_order`)에서 `_get_owned_address`가 이미 로드한 주소를 `OrderShippingAddressOut` 형태 dict로 스냅샷 기록. 토큰 주문은 주소 없음 — 현행 유지.
- `GET /orders/{id}`: `shipping_address_snapshot` 우선, 없으면(스냅샷 도입 전 데이터 방어) 기존 라이브 조인 폴백. **응답 스키마(`OrderDetailOut.shipping_address`) 불변 → OpenAPI·api-client·프론트 무변경.**
- `shipping_address_id` FK는 존치(관리자 화면·감사 추적용 원본 참조).
- 테스트(testcontainers): 주문 생성 → 주소 수정/삭제 → `GET /orders/{id}` 배송지가 주문 시점 값 유지. 스냅샷 없는 구주문의 라이브 조인 폴백 회귀.

## 3. 검증

`pnpm lint` → `pnpm turbo build typecheck test` → `uv run ruff check . && uv run pyright && uv run pytest` → Aside: ① 완료 상태 토큰 주문 상세에서 환불 신청 → 확인 다이얼로그 → 클레임 목록 반영 ② 같은 주문 재진입 시 "확인 중" Callout ③ 클레임 상세에서 신청 취소 → `거부` 전이 ④ 주소 수정 후 기존 주문 상세 배송지 불변 ⑤ 모바일 뷰포트.

## 4. 상태 — 구현·검증 완료 (2026-07-11)

- [x] 플랜 작성 (2026-07-11)
- [x] §1 토큰 환불 배선 — `TokenRefundSection`(features/claims) + 클레임 상세 token_refund 취소 배선 + refund_data 한글 라벨·금액 포맷 + `claimReasonLabel`에 `token_refund` 추가(목록/상세 원문 노출 결함 수정)
- [x] §2 배송지 스냅샷 — Alembic `b0db3ad0771c`(컬럼+백필), 생성 3경로 스냅샷 기록, GET /orders/{id} 스냅샷 우선(+구주문 라이브 조인 폴백), testcontainers 회귀 테스트
- [x] §3 검증 — `pnpm lint`·`pnpm turbo build typecheck test`·`uv run ruff/pyright/pytest`(418+91 subtests) 통과. Aside: 환불 신청→접수 Callout→클레임 목록/상세→신청 취소(거부 전이)→환불 신청 복원 왕복, 주소 수정·삭제 후 주문 상세 배송지 불변, 콘솔 오류 없음. 모바일 에뮬레이션은 Aside 세션 미지원 — 신규 UI가 C9에서 390px 검증된 shared 프리미티브만 사용해 리스크 낮음으로 기록.

주의: token_refund 신청 취소는 서버 semantics상 클레임이 삭제되지 않고 `거부`로 남는다(다른 타입은 DELETE). 목록에 `거부` 행이 남는 것은 의도된 동작.
