# 주문·클레임 통합 상태 표시 플랜 (읽기모델 파생)

> 취소·반품·교환(클레임) 처리를 완료해도 주문내역 화면이 기존 상태를 유지해 오인을 유발한다. money-first 설계·상태기계·DB는 불변으로 두고, **API 읽기모델에 클레임 상태를 파생 필드로 얹어** store·admin 주문 화면에 표시한다.
> 근거: `docs/api-spec/money.md` §6·§8, `db/src/db/models/commerce.py`, orders/claims 도메인. 관련: `docs/plans/store-order-claim.md`, `docs/plans/store-order-claim-followups.md`.

## 1. 현황 (사실관계)

주문 상태(`order.status`)와 클레임 상태(`claim.status`)는 분리된 두 생명주기인데, 주문 화면은 오직 `order.status`만 렌더한다.

- `OrderItem`에 status 컬럼 없음 — 아이템 상태 = `Claim`(order_item_id 연결) 행으로만 존재. store 주문상세는 클레임을 아이템에 붙이지 않아 취소 상품도 원본 제목/수량/가격 그대로 표시.
- `cancel` 클레임을 완료(접수→처리중→완료)해도 `order.status` 미변경(코드상 분리). sale/repair/custom 주문은 Toss 대시보드 환불 → 웹훅 정산 후에야 `order.status='취소'`(money-first, `payments/service.py`).
- 예외: 토큰 환불만 승인 시 order=취소 + claim=완료를 한 트랜잭션에서 처리(`tokens/ledger.py _apply_token_refund`).
- 일관성 불변식 `order.status=='취소' and claim.status=='완료'`, 어긋나면 `PaymentIncident`(`admin/payment_incidents.py`).

**결론:** 데이터(클레임=아이템 상태)는 이미 있고 화면이 숨기는 게 문제. money-first는 의도된 설계이므로 유지한다.

상태값 참고 — 주문 17종(대기중/결제중/진행중/배송중/배송완료/완료/취소/실패/접수/제작중/제작완료/수선중/수선완료/발송대기/발송중/발송확인중/수거예정), 클레임 7종(접수/처리중/수거요청/수거완료/재발송/완료/거부), 타입(cancel/return/exchange/token_refund).

## 2. 방침

- **읽기모델 파생만** — DDL·상태기계 변경 없음. 상태 집계는 API 계층 소유(ARCHITECTURE.md; `customer_actions`를 주문별로 붙이는 기존 패턴에 클레임 요약 추가).
- **비목표:** 취소 클레임 완료 시 `order.status` 자동 캐스케이드(토큰식) — money-first 불변식 위반·이중환불 리스크로 제외.
- 클레임 배지는 클레임 생명주기를 그대로 표시한다. 따라서 `claim.status=완료`면 주문 상태와 무관하게 `"취소 완료"`이며, 정산 상태는 나란히 표시되는 `order.status`와 결제 이상 화면이 별도로 담당한다.
- 활성 클레임 또는 완료된 취소 클레임이 있으면 고객 재요청·구매확정·수선 발송과 관리자 주문 상태·송장 변경을 차단한다. UI 가드뿐 아니라 직접 API 호출에도 동일하게 적용한다.

파생 라벨 매핑(프론트 계산):

| type | claim.status | order.status | 라벨 | 톤 |
|---|---|---|---|---|
| cancel | 접수~처리중 | 무관 | 취소 처리중 | warning |
| cancel | 완료 | 무관 | 취소 완료 | critical |
| cancel | 거부 | — | 취소 거부 | neutral |
| return | 접수~수거완료 | — | 반품 진행중 | informative |
| return | 완료 | — | 반품 완료 | positive |
| exchange | 접수~재발송 | — | 교환 진행중 | informative |
| exchange | 완료 | — | 교환 완료 | positive |
| token_refund | 접수~처리중 | — | 토큰 환불 처리중 | warning |
| token_refund | 완료 | — | 토큰 환불 완료 | positive |
| 전체 | 거부 | — | `{유형} 거부` | neutral |

## 3. 백엔드 — 파생 필드 (스펙 변경 → codegen 필요)

- `apps/api/src/api/domains/orders/schemas.py`: 재사용 shape `ClaimBadgeOut { claim_number, type, status }` 추가.
  - `OrderItemOut.claim: ClaimBadgeOut | None = None` (아이템의 활성-우선-없으면-최신 클레임).
  - `OrderOut.claim_summary: ClaimBadgeOut | None = None` (주문의 활성-우선-없으면-최신; 활성은 유니크 제약상 최대 1개).
  - 백엔드는 원시 문자열만 반환(기존 "서버=한글 상태문자열, 프론트=톤 매핑" 관례 유지).
- `apps/api/src/api/domains/orders/router.py` — `list_my_orders`·`get_order`: 아이템 로드 후 `select(Claim).where(Claim.order_id.in_(order_ids))` 1회 → order_item_id별 최신으로 `item.claim`, order별 활성-우선-최신으로 `claim_summary`. 헬퍼 `ACTIVE_CLAIM_STATUSES`·`_active_claim_order_ids` 재사용.
- `apps/api/src/api/domains/admin/orders.py` — `get_order_detail`(이미 `active_claim` 로드)에 per-item + summary 부착, `list_orders`에 order별 최신 클레임 요약. `AdminOrderSummaryOut`·`AdminOrderDetailOut`·`safe_order_item_out`에 필드 추가.
- "활성이면 그것, 아니면 created_at 최신" 선택 규칙은 순수함수 헬퍼 1개(`orders/service.py`)로 store/admin 공용.
- `pnpm codegen` 후 `packages/api-client` 생성물 같은 커밋에 — CI codegen-drift 검사.

## 4. 프론트

- **store** `pages/order/detail.tsx`: 아이템 카드 `item.claim` 배지 + 헤더 상태 배지 옆 `order.claim_summary` 보조 칩. `pages/my-page/orders.tsx`: 리스트 suffix 보조 배지. `features/claims/model/config.ts`에 §2 매핑 헬퍼 `claimBadge(claim, orderStatus) → {label, tone}` 추가(기존 `claimTypeLabel`·`claimStatusTone` 재사용).
- **admin** `pages/orders/detail.tsx`: 아이템 행 per-item 배지 + 상태 배지 옆 요약 칩(기존 `active_claim` Callout 유지). `pages/orders/list.tsx`: 목록 배지. `shared/ui/status-badge.tsx` 재사용(필요 시 "반품/교환 진행중" 문구만 톤 집합에 보강).

## 5. 검증

- `pnpm codegen`(drift 없음) → `pnpm lint` → `pnpm turbo build typecheck test` → `uv run pytest apps/api/tests -k "order or claim"`.
- pytest(testcontainers, mock 금지): ① 활성 cancel 클레임 주문 → `get_order`가 `claim_summary`·item `claim` 반환 ② claim=완료이면 order 상태와 무관하게 "취소 완료" ③ 완료된 취소가 고객·관리자 주문 액션과 직접 API 변경을 차단.
- Aside(브라우저): store 주문상세 취소요청 → 아이템 배지·주문 보조칩; admin 주문상세/목록 배지. `pnpm --filter store dev`/`admin dev`, 로컬 DB `docker compose up -d` → alembic upgrade → seed.

## 6. 상태 — 구현·검증 완료 (2026-07-15)

- API: 고객·관리자 주문 목록/상세에 `claim_summary`와 아이템별 `claim`을 추가하고, 활성 클레임 우선·없으면 `(created_at, id)` 최신 선택을 공용 읽기모델로 적용했다. DDL·상태기계 변경은 없다.
- 프론트: store·admin 주문 목록/상세에 주문 상태와 클레임 배지를 함께 표시하고, 취소 완료·반품·교환·토큰 환불·거부 매핑을 단위 테스트로 고정했다. 완료된 취소는 store의 재요청·수선 발송 CTA를 숨기고 admin 운영 액션을 사유와 함께 비활성화한다.
- 계약: `pnpm codegen`으로 OpenAPI와 `packages/api-client` 생성물을 동기화했다.
- 검증: `uv run pytest` 650건, `uv run ruff check .`, `uv run ruff format --check .`, `uv run pyright`, 환경변수를 주입한 `pnpm turbo build typecheck test` 10개 task(store 172건, admin 109건 포함), 변경 TS 파일 Biome 및 디자인 시스템 하네스 검사를 통과했다. Aside에서 로컬 실데이터로 store·admin 주문 목록/상세 배지를 확인했다.
- 참고: 저장소 전체 `pnpm lint`는 작업과 무관한 전역 ignore 파일 `.claude/settings.local.json`의 기존 포맷 오류만 보고했다. 해당 개인 로컬 설정은 수정하지 않았다.
- 2026-07-15 UX 보정: 실제 완료 클레임 두 건이 주문 화면에서 처리중으로 보이던 정산 게이트를 제거했다. 완료 취소를 주문 액션 차단 상태로 승격하고 store·admin 실데이터 화면에서 배지와 액션 상태를 재검증했다.
