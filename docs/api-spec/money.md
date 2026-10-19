# 돈 경로 동작 명세 — 주문·결제

주문 생성 3종·결제 확인의 **동작 정본**이다. 기능 개편 금지 — 구현이 이 명세와 달라지면 버그다. 숫자·상태 문자열·수식을 바꾸려면 이 문서를 먼저 고칠 것.

결제 프로바이더는 Toss Payments다. 프론트 successUrl 콜백의 confirm이 주 경로이며,
현재 구현은 상태 복구용 조회 검증 웹훅도 함께 사용한다(§9 자동 대사 참고).

## 1. 채번

- `ORD-YYYYMMDD-NNN`(주문), `CLM-YYYYMMDD-NNN`(클레임), `QUO-YYYYMMDD-NNN`(견적). NNN = 당일 max+1, lpad 3자리.
- 직렬화: 전 prefix 공통 `advisory_xact_lock("num:{prefix}:{date}")` (`api/numbering.py`). 트랜잭션 내에서만 유효.
- 상품 코드: `{3F|SF|KN|BT|XX}-YYYYMMDD-NNN` (카테고리 3fold/sfolderato/knit/bowtie 매핑, 코드 미지정 시 자동).

## 2. 일반 주문 생성 (sale/repair — 구 create_order_txn)

입력: 배송지 id, items[] `{item_id, item_type(product|reform), product_id, selected_option_id, reform_data, quantity, applied_user_coupon_id}`. repair 주문의 수선품은 **항상 고객이 직접 발송한다** — 방문 수거 입력·요금은 2026-08-31에 제거됐다.

검증: 아이템 최대 50개 / 요청 내 item_id 중복 불가·최대 200자 / reform_data 개당 64KB / 배송지 본인 소유 / product quantity 1~10,000·reform quantity=1 / product는 product_id 필수·존재 / reform은 사진+자동·폭·복원 중 하나 이상 필수 / 자동은 지퍼·끈 택1+착용자 키 필수(끈은 딤플 불가, 딤플은 돌려묶기와 함께만 가능) / 폭은 희망 폭 양수 필수 / 복원 메모는 선택·200자 이하.

재고 (결제 전 물리 차감):
- 옵션 선택 시 옵션 재고, 아니면 상품 재고. `FOR UPDATE` 후 `stock IS NOT NULL AND stock < qty`면 오류, 아니면 차감. **NULL = 무제한**.
- 결제 실패·취소 시 재고 복원 없음(원 동작 유지).

단가:
- product: `products.price + coalesce(option.additional_price, 0)`
- reform: 자동 단독 `REFORM_AUTOMATIC_COST`(16,000), 폭 단독 `REFORM_WIDTH_COST`(30,000), 복원 단독 `REFORM_RESTORATION_COST`(30,000), 자동+폭/복원/둘 다 `REFORM_AUTOMATIC_COMBINED_COST`(40,000), 폭+복원 `REFORM_WIDTH_RESTORATION_COST`(30,000). 서버가 현재 상수로 계산해 reform_data에 `cost`를 주입한다.

쿠폰 라인 할인 (아이템별):
1. 같은 쿠폰은 주문(요청) 내 1회만.
2. `user_coupons FOR UPDATE`: status='active', uc.expires_at>now, coupon.is_active, coupon.expiry_date>=today.
3. 라인 할인: percentage `floor(unit*qty*value/100)` / fixed `floor(value)` → `greatest(0, least(할인, unit*qty))` 클램프. 정액 쿠폰은 수량과 무관하게 주문 항목당 1회 적용.
4. 라인 캡: `capped = least(라인할인, max_discount_amount?)` → 단위 재분배 `floor(capped/qty)` + remainder(첫 remainder개 +1). line_discount_total = capped.

주문 분리: `payment_group_id = uuid4()` 하나에 product 주문(order_type=sale)과 repair 주문(order_type=repair)을 분리 생성.
- sale: `shipping_cost=0` 고정(**무료배송 임계 없음**), total = original - discount.
- repair: `shipping_cost=REFORM_SHIPPING_COST`. total = original - discount + shipping.
- 둘 다 status='대기중'. order_items에 unit_price/discount_amount/line_discount_amount 기록.
- reform 이미지 재연결: images에서 완료된 `entity_type='reform_upload' AND entity_id=object_key AND uploaded_by=본인` → `entity_type='reform', entity_id=order_id`로 UPDATE. 0건이면 오류.

쿠폰 상태: 생성 시 `active→reserved`. confirm 시 `reserved→used`. unlock 시 `reserved→active`.

반환: `{payment_group_id, total_amount(그룹 합), orders[]}`. **멱등키 없음**(원 동작 — 재호출 시 중복 주문).

## 3. 맞춤 주문 (custom)

가격 계산 (calculate_custom_order_amounts):
- pricing_constants 키: `SEWING_PER_COST, AUTO_TIE_COST, TRIANGLE_STITCH_COST, SIDE_STITCH_COST, BAR_TACK_COST, DIMPLE_COST, SPODERATO_COST, FOLD7_COST, WOOL_INTERLINING_COST, BRAND_LABEL_COST, CARE_LABEL_COST, SAMPLE_SEWING_COST, SAMPLE_FABRIC_PRINTING_COST, SAMPLE_FABRIC_YARN_DYED_COST` — 하나라도 없으면 오류.
- **주문제작은 샘플비를 포함한 가격이다** — 봉제 없는 주문제작은 없으므로 봉제 샘플비가 항상 1회 들어가고, 원단을 우리가 만들면(fabric_provided=false) 원단 샘플비도 1회 들어간다. 별도의 시작비·세팅비 상수는 없다(§4의 샘플 주문과 같은 상수를 공유하며, 샘플을 먼저 산 고객에게는 §4의 후속 할인쿠폰으로 되돌려준다).
- 옵션: `tie_type ∈ {'', 'AUTO'}`, `interlining ∈ {'', 'WOOL'}`, bool 9종(triangle_stitch, side_stitch, bar_tack, dimple, turn_knot, spoderato, fold7, brand_label, care_label). **dimple·turn_knot은 tie_type='AUTO'에서만** 선택 가능하고 **dimple은 turn_knot과 함께만** 선택 가능하며, turn_knot은 자동 타이 비용에 포함되어 별도 과금하지 않는다.
- `sewing = (SEWING_PER_COST + 선택 옵션 상수 합) * qty + SAMPLE_SEWING_COST`
- fabric: `fabric_provided=true → 0`; 아니면 `round(qty * FABRIC_{design_type}_{fabric_type} / 4) + SAMPLE_FABRIC_{design_type}_COST`. design/fabric_type null이면 오류.
- total = sewing + fabric.

주문 생성: quantity는 1~10,000. `base_unit = floor(total/qty)`, remainder는 item_data.pricing.unit_price_remainder에. 쿠폰은 §2와 동일(unit=base_unit). options 페이로드는 UTF-8 compact JSON 10KB, additional_notes는 500자 제한. reference_images는 최대 5개이며 `upload_id` 검증 후 images에 등록(entity_type='custom_order'). order_items: item_id=`custom-order-{order_id}`, item_type='custom', item_data=`{custom_order:true, quantity, options, reference_images, additional_notes, pricing:{sewing_cost,fabric_cost,total_cost,unit_price_remainder}}`. status='대기중'.

## 4. 샘플 주문 (sample)

- `sample_type ∈ {fabric, sewing, fabric_and_sewing}`. fabric 계열이면 `design_type ∈ {PRINTING, YARN_DYED}` 필수.
- 가격 키: sewing→`SAMPLE_SEWING_COST`, fabric+PRINTING→`SAMPLE_FABRIC_PRINTING_COST`, fabric+YD→`SAMPLE_FABRIC_YARN_DYED_COST`, fabric_and_sewing→**두 상수의 합**(`SAMPLE_SEWING_COST + SAMPLE_FABRIC_{design_type}_COST`). qty=1. 원단+봉제를 묶는 별도 상수는 없다 — 묶음 할인이 없으므로 합산이 곧 정가다.
- options는 UTF-8 compact JSON 10KB, additional_notes는 500자, reference_images는 최대 5개. 쿠폰 적용 가능(§2 규칙, qty=1). item_id=`sample-order-{order_id}`, item_type='sample'.
- **샘플 할인 정책**: 샘플 주문 자체는 정가. **결제 확정 시 후속 정규주문용 할인쿠폰 자동 발급** — sample_type×design_type → (쿠폰명, pricing_constants 키 목록) 매핑 5종(예: sewing→`('SAMPLE_DISCOUNT_SEWING',['sample_discount_sewing'])`). 할인액은 키 목록의 합이고, fabric_and_sewing은 가격과 같은 방식으로 `sample_discount_sewing + sample_discount_fabric_{printing|yarn_dyed}`를 합산한다. coupons를 `ON CONFLICT(name) DO UPDATE`로 동기화(fixed, value=상수값, max=값, expiry 2099-12-31) 후 user_coupons INSERT `ON CONFLICT DO NOTHING`.

## 5. 결제: lock → Toss confirm → confirm / unlock

엔드포인트 흐름 (구 confirm-payment 엣지):
1. 입력 `{paymentKey, orderId(=payment_group_id), amount}`. `paymentKey`는 1~200자, amount는 양의 정수.
2. 그룹 주문 조회(없으면 404) → 전부 본인 소유(아니면 403).
3. **멱등 사전체크**: 전부 결제후 상태면 200 DONE(권위 매핑은 confirm 참조).
4. 개별 status ∈ {대기중, 결제중} 아니면 409 `Order is not payable`.
5. **금액 검증**: `Σ total_price != amount` → 400 `Amount mismatch`.
5-1. **샘플 매핑 사전검증**: sample 주문은 sample_type의 후속 쿠폰 매핑(§4)이 존재해야 함 — 없으면 400 `invalid_sample`. Toss 승인 후에 터지면 "돈 받고 DB 미확정" 수동 개입 창이 생기므로 lock 전에 차단.
6. **lock**: 대기중→결제중(+로그 'payment lock'); 결제중이면 already_locked; 결제후 상태({진행중,발송대기,발송중,접수,완료})면 already_confirmed → Toss 호출 없이 200.
7. **Toss 승인**: `POST https://api.tosspayments.com/v1/payments/confirm`, 헤더 `Authorization: Basic base64(TOSS_SECRET_KEY+":")`, body `{paymentKey, orderId(=group id), amount(=DB 재계산 합)}`. 멱등키 헤더 미사용(멱등성은 DB 상태로).
8. 실패 → **unlock**(결제중→대기중 + 쿠폰 reserved→active + 로그 'payment unlock: approval failed') 후 Toss 상태코드 전달. 네트워크 예외 → unlock 후 502.
9. 성공 → **confirm**: 각 주문 `status='결제중'`에서만(아니면 오류) →
   | order_type | 확정 상태 |
   |---|---|
   | sale | 진행중 |
   | sample | 접수 |
   | repair | 발송대기 |
   payment_key 저장(로그에는 `****`+뒤 8자 마스킹), 로그 memo `payment confirmed: <masked>`.
   - sample 주문: §4 후속 쿠폰 발급.
   - 마지막에 쿠폰 `reserved→used`(used_at=now).

## 6. 토큰 원장 (삭제)

2026-10-19 AI 디자인·디자인 토큰 서비스 종료로 삭제했다. 절 번호는 코드 주석 참조를 지키려고 비워 둔다.

## 7. 구매 확정·배치

- **고객 확정**: status ∈ {배송중, 배송완료}에서만, 활성 클레임 있으면 거부. → '완료'+confirmed_at, 로그 '고객 직접 구매확정'.
- **자동 확정 (배치)**: `배송완료 AND delivered_at <= now-7d` 또는 `배송중 AND (repair? company_shipped_at : shipped_at) <= now-7d`, 활성 클레임 없음. FOR UPDATE SKIP LOCKED. changed_by=NULL, memo `자동 구매확정 (... 7일 경과)`.
- **stale 취소 (배치)**: `대기중 AND created_at < now-30분` → '취소'. SKIP LOCKED. memo '자동 취소 (대기중 30분 초과)'. (스케줄 30분 주기 — 최악 60분 내 정리, perf-cost-reduction 리뷰 20번.)
- **환불 계산**: 허용 상태(sale: 대기중/결제중/진행중, custom·repair·sample: +접수)에서 `refund = total_price` 전액.

## 8. 주문 상태기계 (admin)

공통: 활성 클레임({접수,처리중,수거요청,수거완료,재발송}) 있으면 상태 변경 불가. 롤백이면 memo 필수. 로그(order_status_logs) 필수.

정방향:
- sale: 대기중→진행중→배송중→배송완료→완료. 취소 ← {대기중,결제중,진행중}
- custom: 대기중→접수→제작중→제작완료→배송중→배송완료→완료. 취소 ← {대기중,결제중,접수}
- sample: 접수→제작중→배송중→배송완료→완료. 취소 ← {대기중,결제중,접수}
- repair: {발송대기,발송중,발송확인중}→접수→수선중→수선완료→배송중→배송완료→완료. 취소 ← {대기중,결제중,발송대기,발송중,발송확인중} — 발송대기→접수는 §9 의도적 추가(고객 미등록 입고 시 관리자 강제 접수)

- **배송중 알림톡**: status가 배송중 AND 송장 완비(택배사·송장번호 모두 존재; repair는 company_courier_company·company_tracking_number, 그 외는 courier_company·tracking_number)가 되는 순간 1회 발송. 두 조건 중 나중에 충족되는 쪽(상태 변경 또는 송장 저장) 커밋 직후 best-effort. 롤백 제외. 수신 4조건(notification_consent·notification_enabled·phone_verified·phone). 송장을 지웠다 다시 넣으면 재발송(의도). 템플릿 미설정이면 건너뜀.

롤백 (현재 상태가 {배송중,배송완료,완료,취소,수거완료,재발송}이면 불가):
- sale: 결제중→대기중, 진행중→대기중
- custom: 결제중→대기중, 접수→대기중, 제작중→접수, 제작완료→제작중
- sample: 결제중→대기중, 접수→대기중, 제작중→접수
- repair: 접수→order_status_logs에 보존된 직전 발송 상태(legacy 수거예정은 발송대기, 판별 불가하면 롤백 없음), 수선중→접수, 수선완료→수선중

고객 액션(get_order_customer_actions): claim_cancel(sale{대기중,진행중}/custom{대기중,접수}/sample{대기중,접수}/repair{대기중,발송대기,발송중,발송확인중}), claim_return·claim_exchange(sale {배송중,배송완료}만), confirm_purchase({배송중,배송완료}, 활성 클레임 없음).

## 9. 재구현 시 결정 사항 (원문과 의도적 차이)

- 스케줄러는 Cloud Scheduler → `POST /batch/*` (pg_cron 이미 제거된 상태였음).
- Toss 호출 금액은 항상 DB 재계산 합(원 동작 유지). 클라이언트 amount는 사전 일치 검증만.
- stale 대기중 주문 자동 취소 시 해당 주문 소유자의 예약 쿠폰을 `reserved→active`로 복원한다(원문은 쿠폰이 영구 잠기는 누락이 있었음).
- **repair 발송 확인 단순화 (원문과 의도적 차이 — UX 재검토로 결정)**: 결제 후 고객에게 필수로 받는 것은 "발송했다"는 확인뿐. 송장번호·사진은 선택 증빙(송장 있으면 발송중, 없으면 발송확인중 — 두 상태는 유지), no_tracking의 reason(quick/overseas/lost)은 선택화(원문은 필수). tracking 영수증에도 memo 허용. 고객이 아무 확인 없이 보낸 실물이 입고되면 관리자가 `발송대기→접수` 강제 전이(원문 전이표에는 없던 추가).
- **자동 대사 2겹 추가 (원문에 없던 보강 — 제품 관점 재검토로 결정)**:
  - confirm 재시도가 `ALREADY_PROCESSED_PAYMENT`를 받으면 실패(→unlock→stale 취소 = "돈 받고 주문 취소") 대신 **조회 API로 상태·orderId·금액 검증 후 DB 확정**.
  - `POST /payments/webhook`(공개): Toss 상태 변경 통지 수신. **페이로드 불신 — 조회 API 재검증**(Toss 공식 권장, Stripe식 HMAC 서명은 미제공) 후 불일치만 교정: 멈춘 '결제중' 확정 / 대시보드 직접 취소 동기화. 입력 `paymentKey`는 최대 200자이며, Toss 조회에서 4xx로 확인된 키는 인스턴스별 bounded TTL cache로 짧게 억제한다. IP 제한과 이 cache는 Cloud Run 인스턴스 내부 보조선이고, 전체 트래픽 제한은 Cloudflare WAF가 담당한다. 취소 동기화 전에는 조회 응답·저장 `paymentKey`와 총액이 모두 일치해야 한다. 부분취소·혼합상태·식별자/금액불일치는 자동 교정하지 않고 open `mixed_state` incident와 critical 로그로 남긴다(수동). 사용확정된 쿠폰 복원도 수동 정책. 조회 5xx만 5xx 응답으로 Toss 재시도 유도 — 그 외는 200 ack. 대시보드 웹훅 URL은 production 공개 API 도메인으로 등록한다.
