# 수선 방문 수거 제거 — 실행 기록 (2026-08-31)

플랜: `docs/plans/remove-repair-pickup-service.md` (실행 완료로 제거).
운영이 기사 배차·일정을 감당할 수 없어 방문 수거를 폐지하고, 고객이 항상 직접 택배로
발송하게 했다. 전 레이어(스키마·API·명세·store·admin·문구·테스트)에서 제거 완료.

## 스코프 — "수거"는 두 계통이었다

제거한 것은 repair 주문의 방문 수거뿐이다. **클레임(반품/교환)의 `수거요청`/`수거완료`
상태는 그대로 유지** — `repair_pickup_requests`와 무관한 별개 워크플로다
(`claims/service.py`, `packages/shared/src/claim-badge.ts`, admin 클레임 목록).
택배사 목록·`default_courier_company`도 고객 직접 발송·반환 배송에 쓰이므로 유지.

## 변경

| 레이어 | 내용 |
|---|---|
| DB 모델 | `RepairPickupRequest` 삭제, `orders.status` CHECK에서 `'수거예정'` 제거 |
| 마이그레이션 | `20260831_e6b3d15a9c47_drop_repair_pickup.py` — `수거예정`→`발송대기` 이관 → CHECK 재작성 → 테이블 drop → `pricing_constants`의 `REFORM_PICKUP_FEE` 삭제 |
| API 스키마 | `RepairPickupIn`·`RepairShippingIn`·`RepairPickupOut` 삭제, `OrderCreateRequest.repair_shipping`·`OrderDetailOut.repair_pickup`·`AdminOrderDetailOut.repair_pickup`·`AdminClaimShippingOut.repair_pickup` 제거 |
| 주문 생성 | `create_order`의 pickup 검증·`invalid_pickup`·수거비 합산·`RepairPickupRequest` INSERT 제거, `_create_group_order`의 `extra_fee` 파라미터 삭제 |
| 상태기계 | FORWARD·CANCELABLE_FROM·CLAIM_CANCEL_ACTION_FROM에서 `수거예정` 제거 |
| 결제 confirm | `_post_status`가 pickup exists 쿼리를 버리고 repair는 항상 `발송대기` — DB 조회가 없어져 `async def` → `def`(호출처 4곳) |
| 롤백 대상 | `repair_previous_status`·admin `_repair_previous_statuses`에서 pickup 분기 제거 |
| 가격 상수 | `REFORM_PICKUP_FEE` 사슬 전체(`config_defaults.py`·admin `configuration.py`·`reform/service.py`·`ReformPricingOut.pickup_fee`·admin pricing 라벨) |
| read model | `repair_shipping_read_model`(튜플) → `repair_receipts_read_model`(리스트) |
| store | 체크아웃의 라디오·수거지 폼·수거비 행·검증 전부 삭제, "수선품 보내는 방법" 섹션은 직접 발송 안내 + 기존 "이미 발송했어요"만 남김. `calculateTotals`의 pickup 인자·반환 제거. 결제완료·주문상세·상태 톤에서 pickup 제거 |
| admin | 주문 상세의 수거 요청 카드·금액 분해 라벨(`원금 − 할인 + 배송비`)·배송 탭 조건, 주문 목록 상태 필터, 클레임 상세 수거 섹션 |
| 문구 | FAQ·공지·환불정책·이용약관·리폼 랜딩에서 방문 수거 삭제. `{{REFORM_PICKUP_FEE}}` 토큰은 정의(`use-reform-pricing-tokens.ts`)까지 함께 제거 — 남기면 치환 안 된 리터럴이 노출된다 |
| 명세 | `docs/api-spec/money.md` §2·§5·§8의 11군데. §2에 "항상 고객이 직접 발송" 한 줄로 대체 |
| 생성물 | `pnpm codegen` 재생성 — pickup 참조 0건 |
| 시드 | `seed.py`의 `RepairPickupRequest` 픽스처 삭제 |

## 데이터 처리 (되돌릴 수 없는 부분)

로컬 실행 시점 데이터: `repair_pickup_requests` 2행, `status='수거예정'` 주문 1건 → 마이그레이션이
`발송대기`로 이관하고 테이블을 지웠다. **과거 pickup 주문의 수거비 스냅샷은 이 테이블에만
있었으므로 사라진다** — 금액은 `orders.total_price`에 이미 합산돼 결제·환불액은 보존되지만,
admin 금액 분해(원금 − 할인 + 배송비)가 과거 pickup 주문에서 total_price와 어긋난다(의도된 손실).
`order_status_logs`의 `수거예정` 문자열은 감사 추적이라 그대로 남긴다(제약 없음).

**프로덕션 적용 전 확인 필요**: `select count(*) from repair_pickup_requests`와
`status='수거예정'` 주문. 진행 중인 실주문이 있으면 운영이 수동 처리한 뒤 배포할 것.

## 검증 (통과)

- `uv run pytest` — 영향 파일 58 passed(orders_create·repair_shipping·claims·admin_phase_d·
  phone_numbers·cart·reform·test_migrations), payment/order/admin 필터 318 passed.
- 마이그레이션 **왕복 실측** — upgrade 후 테이블 0건·`수거예정` 0건·가격상수 0건,
  downgrade 후 테이블·상수 복원, 재upgrade 성공. `seed.py` 재실행 정상.
- `pnpm lint`·`architecture:check`·`typecheck`·`build`·`test`(store 242 / admin 241 / shared 69) 통과.
- `rg -i "pickup|수거예정|REFORM_PICKUP_FEE"` 잔재 0 — 남은 히트는 클레임 `수거요청/수거완료`
  계열과 money.md의 제거 기록 문장뿐.

## 테스트 처리

- `test_repair_order_with_pickup_splits_group` → **`test_repair_order_splits_group`으로 존치**.
  플랜은 삭제를 지시했지만 이 테스트의 본체는 sale/repair 결제 그룹 분리 검증이라 pickup만
  떼고 총액 기대치를 22,500원(sale 10,000 + repair 8,000 + 배송 4,500)으로 고쳤다.
- `test_custom_sample_and_pickup_inputs_have_schema_bounds` → pickup 케이스만 제거하고 개명.
- `test_phone_write_models_store_canonical_digits` — `RepairPickupIn` 대신 남은 write 모델
  (`ShippingAddressIn`·`ManualOrderCreateRequest`)로 정규화 검증 유지.
- 삭제: store `shipment.test.ts`의 "수거예정 → pickup" 1건.

## 남은 정리 (선택)

`apps/store/src/pages/order/order-form.tsx`는 체크아웃 단위 테스트가 없다 — `calculateTotals`는
서버가 `amount_mismatch`로 재검증하므로 방어선은 있지만, 이 페이지에 테스트를 붙일 계획이면
그때 총액 계산부터 잡는 것이 좋다.
