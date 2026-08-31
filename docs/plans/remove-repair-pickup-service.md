# 수선 방문 수거 서비스 제거

repair 주문의 "기사 방문 수거" 옵션(`repair_shipping.method = "pickup"`, `RepairPickupRequest`,
주문 상태 `수거예정`, 설정값 `REFORM_PICKUP_FEE`)을 전 레이어에서 제거한다. 고객은 항상
직접 택배를 발송한다. 2026-08-31 조사 기준.

## 왜 필요한가

방문 수거는 운영(기사 배차·일정 관리)이 감당되지 않아 실제로 제공할 수 없는 서비스다.
선택지로 남겨두면 고객이 신청하고 회사가 이행하지 못하는 사고가 난다. 운영 판단이며 실측
근거는 없다(운영자 결정, 2026-08-31).

## 범위 밖 (non-goals)

- **클레임(반품/교환) 상태 `수거요청`/`수거완료`는 건드리지 않는다.** sale 주문의 클레임
  워크플로로, `RepairPickupRequest`·`pickup` 코드와 완전히 별개 도메인이다
  (`apps/api/src/api/domains/claims/service.py:31-52`, `apps/api/src/api/domains/orders/status_machine.py:5`,
  `packages/shared/src/claim-badge.ts:21`, `apps/store/src/features/claims/model/config.ts:94`,
  `apps/admin/src/pages/claims/list.tsx:35-36`).
- **택배사 목록과 `default_courier_company` 설정은 유지** — 고객 직접 발송·회사 반환 배송에
  쓰인다 (`apps/store/src/features/repair-shipping/model/couriers.ts`, admin settings).
- 직접 발송 플로우(송장 등록, `발송대기`→`접수`)는 변경하지 않는다.

## 실행 조건

- 프로덕션 데이터 확인이 선행돼야 한다:
  `select count(*) from repair_pickup_requests` 와
  `select count(*) from orders where status = '수거예정'`.
- 행이 있으면: `수거예정` 주문을 `발송대기`로 이관하는 data migration을 같은 리비전에
  포함하고, `repair_pickup_requests`는 drop 전에 CSV로 백업한다(과거 주문의 수거비 스냅샷이
  유일하게 이 테이블에 있음 — 지우면 admin 금액 분해가 안 맞는 주문이 생기는 걸 감수한다는
  결정 포함). 이 결정 없이 마이그레이션을 실행하지 말 것.
- `수거예정` 상태로 **진행 중**(미완료·미취소)인 실주문이 있으면 실행하지 말고, 해당 주문을
  운영이 수동 처리(취소 또는 수거 이행)한 뒤 실행한다.

## 절차

각 항목은 위에서부터 순서대로. 1–4가 한 커밋(백엔드+명세+생성물), 5–7이 한 커밋(프론트)으로
나뉘는 크기다.

1. **API 주문 도메인에서 pickup 제거** — `apps/api/src/api/domains/orders/schemas.py:53-68`의
   `RepairPickupIn`·`RepairShippingIn`과 `:74` `OrderCreateRequest.repair_shipping`,
   `:217-225` `RepairPickupOut`, `:250` `repair_pickup` 필드를 삭제한다. `repair_shipping`은
   pickup 외 용도가 없으므로(`service.py:445` 이후 `method`만 사용) 필드 전체를 없앤다.
   `apps/api/src/api/domains/orders/service.py`에서 pickup 분기 전부 삭제:
   `:445`(method 파싱), `:497-534`(invalid_pickup 검증·pickup_fee), `:544-556`(extra_fee 전달과
   `RepairPickupRequest` INSERT), `:336-348`(read model), `:1042-1056`(롤백 대상 `수거예정`).
   `_create_group_order`의 `extra_fee` 파라미터도 호출처가 없어지면 함께 제거(`:584, :598`).
2. **상태 `수거예정`·결제 분기 제거** — `apps/api/src/api/domains/orders/status_machine.py:34, :48, :110`에서
   `수거예정` 항목 삭제. `apps/api/src/api/domains/payments/service.py:99-103`의
   `_post_status()` exists 쿼리를 없애고 repair는 무조건 `발송대기`로.
   admin 쪽: `apps/api/src/api/domains/admin/schemas.py:39, :205`,
   `apps/api/src/api/domains/admin/orders.py:165-197, :708, :752`,
   `apps/api/src/api/domains/admin/claims_schemas.py:129`,
   `apps/api/src/api/domains/admin/claim_operations.py:459-460, :506`에서 `수거예정`·`repair_pickup` 제거.
3. **설정값 `REFORM_PICKUP_FEE` 사슬 제거** — `apps/api/src/api/config_defaults.py:45`,
   `apps/api/src/api/domains/admin/configuration.py:28`,
   `apps/api/src/api/domains/reform/service.py:29, :42`,
   `apps/api/src/api/domains/reform/schemas.py:15`(`ReformPricingOut.pickup_fee`),
   `apps/admin/src/pages/pricing.tsx:55`(라벨). 시드의 pickup 데이터도 삭제:
   `apps/api/scripts/seed.py:37, :416-424`. admin_settings에 이미 시드된 키는 마이그레이션에서
   DELETE한다(남겨도 무해하지만 admin 설정 화면 정합을 위해).
4. **DB 마이그레이션 + 명세 갱신 + codegen** — `db/src/db/models/commerce.py:495-507`의
   `RepairPickupRequest` 모델과 `:214` orders status CHECK의 `'수거예정'` 삭제. 신규 Alembic
   리비전 추가(베이스라인 `20260803_f8c3b2a19d47` 수정 금지) — 상태 CHECK 재작성은 선례
   `db/migrations/versions/20260811_e71baf2532ce_claim_status_cancel.py` 방식을 본뜬다.
   내용: `update orders set status='발송대기' where status='수거예정'` → CHECK 재작성 →
   `drop table repair_pickup_requests` → `delete from admin_settings where key='REFORM_PICKUP_FEE'`.
   `docs/api-spec/money.md`의 pickup 11군데(§2 입력 스펙 `:17, :19`, 요금 `:37`, 멱등 `:73, :146`,
   confirm 표 `:82`, 상태 전이표 `:131, :134, :138, :141`)를 함께 갱신한다(대원칙).
   `pnpm codegen`으로 `packages/api-client` 재생성(수동 수정 금지) — 재생성 후 store의
   `RepairShippingIn` 임포트가 타입 에러로 잡히는 게 정상이다.
5. **store 체크아웃·주문 화면** — `apps/store/src/pages/order/order-form.tsx`에서 pickup 관련
   상태·payload·검증·금액 행·UI 블록 전부 삭제(`:83-117, :145-189, :235-250, :313-330, :358-378,
   :416-527, :675-706`). 라디오가 선택지 1개가 되므로 "수선품 보내는 방법" 섹션은 라디오 없이
   "결제 후 안내에 따라 직접 택배로 발송해 주세요" 류 안내 문구로 대체한다.
   `apps/store/src/pages/order/payment-success.tsx:39-46, :122, :236-244`와
   `apps/store/src/features/repair-shipping/model/post-confirm.ts:6, :20`의 pickup 분기,
   `apps/store/src/pages/order/detail.tsx:195-204, :259-276`,
   `apps/store/src/features/orders/model/display.ts:24`의 `수거예정` 제거.
6. **admin 화면** — `apps/admin/src/pages/orders/detail.tsx:408, :731-737, :922-943`
   (금액 분해 라벨은 "원금 − 할인 + 배송비 = 주문 금액"으로), `apps/admin/src/pages/orders/list.tsx:57`
   상태 필터, `apps/admin/src/pages/claims/detail.tsx:409, :812-835`.
7. **정책·마케팅 문구** — `apps/store/src/pages/reform/index.tsx:378`,
   `apps/store/src/pages/faq/model/faq-data.ts:39, :121`,
   `apps/store/src/pages/notice/model/notice-data.ts:32, :37`,
   `apps/store/src/pages/refund-policy/index.tsx:104`,
   `apps/store/src/pages/terms-of-service/index.tsx:57`에서 방문 수거 언급 삭제.
   `{{REFORM_PICKUP_FEE}}` 토큰은 치환이 안 되면 리터럴로 노출되므로, 문구에서 지우면서
   `apps/store/src/shared/lib/use-reform-pricing-tokens.ts:13-14, :25`의 토큰 정의도 함께 제거한다.
8. **테스트 정리** — 삭제: `apps/api/tests/test_orders_create.py:191`(pickup 분할 테스트),
   `apps/store/src/features/repair-shipping/model/shipment.test.ts:226-228`. 수정:
   `test_orders_create.py:564`(pickup 필드 상한 부분만 제거), `test_repair_shipping.py:103-232`
   (pickup 픽스처 제거), `test_admin_phase_d.py:112-264`, `test_claims.py:97`,
   `test_cart.py:25`·`test_reform.py:15-25`(REFORM_PICKUP_FEE 픽스처),
   `test_phone_numbers.py:36-60`(`RepairPickupIn` 대신 다른 write 모델로 전화 정규화 검증 —
   검증 자체는 유지), `apps/store/src/pages/order/detail.test.tsx:199-262`,
   `apps/admin/src/pages/orders/detail.test.tsx:589-711`, `apps/admin/src/pages/claims/detail.test.tsx:111`.
   `tests/test_migrations.py`는 신규 리비전 추가 후 반드시 실행. e2e는 pickup 단정이 없어 수정 불필요.

## 검증

- `uv run pytest apps/api/tests/test_orders_create.py apps/api/tests/test_repair_shipping.py apps/api/tests/test_claims.py apps/api/tests/test_admin_phase_d.py apps/api/tests/test_phone_numbers.py tests/test_migrations.py`
- `pnpm build && pnpm typecheck && pnpm test` (api-client 재생성 잔재는 typecheck가 잡는다)
- `pnpm architecture:check` (money.md 문서 수정 포함이므로)
- `docker compose exec -T db psql -U essesion -d essesion -c "select 1 from information_schema.tables where table_name='repair_pickup_requests'"` → 0행
- 브라우저(Aside): store 체크아웃에서 reform 아이템 주문 → 수거 옵션이 없고 결제 총액에
  수거비가 없는지, 결제 완료 화면이 직접 발송 안내로 뜨는지 확인.
- grep 잔재 검사: `rg -i "pickup|수거예정|REFORM_PICKUP_FEE" apps packages db docs/api-spec` —
  남는 히트는 클레임 `수거요청/수거완료` 계열뿐이어야 한다.

## 되돌리는 법 / 상향 신호

- Alembic downgrade로 테이블·CHECK는 복원되지만 `수거예정`→`발송대기` 이관과 삭제된 행은
  안 돌아온다(drop 전 CSV 백업이 유일한 복구원). 코드 복원은 git revert 2커밋.
- 상향 신호: 없음 — 재도입하려면 새 플랜으로.

## 기각한 대안

- **`method: Literal["direct"]`만 남기기** — 마이그레이션은 줄지만 무의미한 필드·테이블이
  영구히 남는다. 완전 제거가 더 싸다. 재론 조건: 프로덕션에 `수거예정` 진행 주문이 많아
  이관이 위험해질 때.
- **UI에서만 숨기기(API는 유지)** — API가 살아 있으면 결제 경로에 죽은 분기(`extra_fee`,
  `수거예정`)가 남아 money.md 명세와 코드가 계속 이중 부담이 된다. 기각.

이 플랜의 실패 모드: 클레임 `수거요청/수거완료`를 pickup으로 오인해 함께 지우는 것,
그리고 admin_settings·기존 주문 데이터 이관 없이 CHECK 제약만 바꿔 마이그레이션이
프로덕션에서 실패하는 것.
