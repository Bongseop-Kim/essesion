# 돈 경로 동작 명세 (YeongSeon 추출 — 구현 기준)

원본: YeongSeon `supabase/schemas/{93,95,98,99}_functions_*.sql`, `supabase/functions/{create-order,create-custom-order,create-sample-order,confirm-payment,cancel-token-payment}`. 기능 개편 금지 — 이 명세와 동작이 달라지면 버그다. 숫자·상태 문자열·수식은 원문 그대로.

결제 프로바이더는 Toss Payments다. 프론트 successUrl 콜백의 confirm이 주 경로이며,
현재 구현은 상태 복구용 조회 검증 웹훅도 함께 사용한다(§7 자동 대사 참고).

## 1. 채번

- `ORD-YYYYMMDD-NNN`(주문), `TKN-YYYYMMDD-NNN`(토큰 주문), `CLM-YYYYMMDD-NNN`(클레임), `QUO-YYYYMMDD-NNN`(견적). NNN = 당일 max+1, lpad 3자리.
- 직렬화: `pg_advisory_xact_lock(hashtext(prefix||date))` (ORD는 date만). 트랜잭션 내에서만 유효.
- 상품 코드: `{3F|SF|KN|BT|XX}-YYYYMMDD-NNN` (카테고리 3fold/sfolderato/knit/bowtie 매핑, 코드 미지정 시 자동).
- 토큰 환불 클레임 번호는 별도: `TKR-YYYYMMDDHH24MISS-<uuid 앞 4자>`.

## 2. 일반 주문 생성 (sale/repair — 구 create_order_txn)

입력: 배송지 id, items[] `{item_id, item_type(product|reform), product_id, selected_option_id, reform_data, quantity, applied_user_coupon_id}`, repair_shipping `{method: direct|pickup, pickup:{recipient_name, recipient_phone, postal_code?, address, detail_address?}}`.

검증: 아이템 최대 50개 / 요청 내 item_id 중복 불가·최대 200자 / reform_data 개당 64KB / 배송지 본인 소유 / product quantity 1~10,000·reform quantity=1 / product는 product_id 필수·존재 / reform은 사진+자동·폭·복원 중 하나 이상 필수 / 자동은 지퍼·끈 택1+착용자 키 필수(끈은 돌려묶기 불가) / 폭은 희망 폭 양수 필수 / 복원 메모는 선택·200자 이하 / pickup은 reform 아이템이 있어야 하고 수령인 3필드 필수(이름 100·전화 32·주소/상세 500·우편번호 20자 상한).

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
- repair: `shipping_cost=REFORM_SHIPPING_COST`, pickup이면 + `REFORM_PICKUP_FEE`(repair_pickup_requests에 스냅샷). total = original - discount + shipping + pickup_fee.
- 둘 다 status='대기중'. order_items에 unit_price/discount_amount/line_discount_amount 기록.
- reform 이미지 재연결: images에서 완료된 `entity_type='reform_upload' AND entity_id=object_key AND uploaded_by=본인` → `entity_type='reform', entity_id=order_id`로 UPDATE. 0건이면 오류.

쿠폰 상태: 생성 시 `active→reserved`. confirm 시 `reserved→used`. unlock 시 `reserved→active`.

반환: `{payment_group_id, total_amount(그룹 합), orders[]}`. **멱등키 없음**(원 동작 — 재호출 시 중복 주문).

## 3. 맞춤 주문 (custom)

가격 계산 (calculate_custom_order_amounts):
- pricing_constants 키: `START_COST, SEWING_PER_COST, AUTO_TIE_COST, TRIANGLE_STITCH_COST, SIDE_STITCH_COST, BAR_TACK_COST, DIMPLE_COST, SPODERATO_COST, FOLD7_COST, WOOL_INTERLINING_COST, BRAND_LABEL_COST, CARE_LABEL_COST, YARN_DYED_DESIGN_COST` — 하나라도 없으면 오류.
- 옵션: `tie_type ∈ {'', 'AUTO'}`, `interlining ∈ {'', 'WOOL'}`, bool 9종(triangle_stitch, side_stitch, bar_tack, dimple, turn_knot, spoderato, fold7, brand_label, care_label). **dimple·turn_knot은 tie_type='AUTO'에서만** 선택 가능하며, turn_knot은 자동 타이 비용에 포함되어 별도 과금하지 않는다.
- `sewing = (SEWING_PER_COST + 선택 옵션 상수 합) * qty + START_COST`
- fabric: `fabric_provided=true → 0`; 아니면 `round(qty * FABRIC_{design_type}_{fabric_type} / 4) + (design_type='YARN_DYED'? YARN_DYED_DESIGN_COST : 0)`. design/fabric_type null이면 오류.
- total = sewing + fabric.

주문 생성: quantity는 1~10,000. `base_unit = floor(total/qty)`, remainder는 item_data.pricing.unit_price_remainder에. 쿠폰은 §2와 동일(unit=base_unit). options 페이로드는 UTF-8 compact JSON 10KB, additional_notes는 500자 제한. reference_images는 최대 5개이며 `upload_id` 검증 후 images에 등록(entity_type='custom_order'). order_items: item_id=`custom-order-{order_id}`, item_type='custom', item_data=`{custom_order:true, quantity, options, reference_images, additional_notes, pricing:{sewing_cost,fabric_cost,total_cost,unit_price_remainder}}`. status='대기중'.

## 4. 샘플 주문 (sample)

- `sample_type ∈ {fabric, sewing, fabric_and_sewing}`. fabric 계열이면 `design_type ∈ {PRINTING, YARN_DYED}` 필수.
- 가격 키: sewing→`SAMPLE_SEWING_COST`, fabric+PRINTING→`SAMPLE_FABRIC_PRINTING_COST`, fabric+YD→`SAMPLE_FABRIC_YARN_DYED_COST`, both+PRINTING→`SAMPLE_FABRIC_AND_SEWING_PRINTING_COST`, both+YD→`SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST`. qty=1.
- options는 UTF-8 compact JSON 10KB, additional_notes는 500자, reference_images는 최대 5개. 쿠폰 적용 가능(§2 규칙, qty=1). item_id=`sample-order-{order_id}`, item_type='sample'.
- **샘플 할인 정책**: 샘플 주문 자체는 정가. **결제 확정 시 후속 정규주문용 할인쿠폰 자동 발급** — sample_type×design_type → (쿠폰명, pricing_constants 키) 매핑 5종(예: sewing→`('SAMPLE_DISCOUNT_SEWING','sample_discount_sewing')`). coupons를 `ON CONFLICT(name) DO UPDATE`로 동기화(fixed, value=상수값, max=값, expiry 2099-12-31) 후 user_coupons INSERT `ON CONFLICT DO NOTHING`.

## 5. 결제: lock → Toss confirm → confirm / unlock

엔드포인트 흐름 (구 confirm-payment 엣지):
1. 입력 `{paymentKey, orderId(=payment_group_id), amount}`. `paymentKey`는 1~200자, amount는 양의 정수.
2. 그룹 주문 조회(없으면 404) → 전부 본인 소유(아니면 403).
3. **멱등 사전체크**: 전부 결제후 상태면 200 DONE(권위 매핑은 confirm 참조).
4. 개별 status ∈ {대기중, 결제중} 아니면 409 `Order is not payable`.
5. **금액 검증**: `Σ total_price != amount` → 400 `Amount mismatch`.
5-1. **샘플 매핑 사전검증**: sample 주문은 sample_type의 후속 쿠폰 매핑(§4)이 존재해야 함 — 없으면 400 `invalid_sample`. Toss 승인 후에 터지면 "돈 받고 DB 미확정" 수동 개입 창이 생기므로 lock 전에 차단.
6. **lock**: 대기중→결제중(+로그 'payment lock'); 결제중이면 already_locked; 결제후 상태({진행중,발송대기,발송중,수거예정,접수,완료})면 already_confirmed → Toss 호출 없이 200.
7. **Toss 승인**: `POST https://api.tosspayments.com/v1/payments/confirm`, 헤더 `Authorization: Basic base64(TOSS_SECRET_KEY+":")`, body `{paymentKey, orderId(=group id), amount(=DB 재계산 합)}`. 멱등키 헤더 미사용(멱등성은 DB 상태로).
8. 실패 → **unlock**(결제중→대기중 + 쿠폰 reserved→active + 로그 'payment unlock: approval failed') 후 Toss 상태코드 전달. 네트워크 예외 → unlock 후 502.
9. 성공 → **confirm**: 각 주문 `status='결제중'`에서만(아니면 오류) →
   | order_type | 확정 상태 |
   |---|---|
   | sale | 진행중 |
   | token | 완료 |
   | sample | 접수 |
   | repair (pickup 요청 있음) | 수거예정 |
   | repair (그 외) | 발송대기 |
   payment_key 저장(로그에는 `****`+뒤 8자 마스킹), 로그 memo `payment confirmed: <masked>`.
   - token 주문: order_items에서 `{token_amount, plan_key}` → design_tokens INSERT `{amount, type:'purchase', class:'paid', work_id:'order_'+order_id, source_order_id, expires_at: now+1년}` ON CONFLICT(work_id) DO NOTHING.
   - sample 주문: §4 후속 쿠폰 발급.
   - 마지막에 쿠폰 `reserved→used`(used_at=now).

## 6. 토큰 원장·플랜·환불

- **플랜**: pricing_constants `token_plan_{starter|popular|pro}_{price|amount}` 6키 (DB가 소스).
- **토큰 주문 생성**: 플랜 검증 → `TKN-` 채번 → orders(order_type='token', 배송지 NULL, total=price) + order_items(item_type='token', item_data={plan_key, token_amount}).
- **차감 (use)**: 비용 = admin_settings `design_token_cost_openai_render_standard`(현행 5). 유저 `pg_advisory_xact_lock(hashtext(user_id))`. 진행 중 토큰환불 클레임(접수) 있으면 `refund_pending` 거부. 잔액(만료 제외: `expires_at IS NULL OR > now()`) < 비용 → `insufficient_tokens`. **유료 우선**: paid를 (source_order_id, expires_at) 그룹별 **만료 임박순**으로 배치 차감(work_id `{work}_use_paid_{i}`), 잔여는 bonus(work_id `{work}_use_bonus`). 전부 ON CONFLICT(work_id) DO NOTHING — work_id 멱등(기존 `_use_paid|_use_paid_0|_use_paid_legacy|_use_bonus` 존재 시 이미 차감으로 간주).
- **실패 환불 (refund)**: 내부 전용. 실제 차감 행마다 class·source_order_id·expires_at을 보존한 양수 반전 행을 INSERT한다. work_id는 각 `{work}_use_*_refund`로 필수 멱등.
- **잔액**: `{total, paid, bonus(=bonus+free)}` — 만료 제외 합.
- **가입 지급**: 신규 유저 생성 시(소셜 가입) admin_settings `design_token_initial_grant`(기본 30), type='grant', class='free', **만료 없음**.
- **admin 지급/회수**: amount≠0, description 필수, 음수면 잔액 검증(유저 lock). type='admin', class='paid'.
- **환불 요청 (고객)**: 조건 = ①본인 완료(status='완료') 토큰 주문 ②paid 지급분 존재·미만료 ③**가장 최근 완료 토큰 주문일 것** ④지급 이후 type='use' 내역 없음 ⑤중복 요청 없음(거부 제외). refund_amount = total_price 전액. claims INSERT: type='token_refund', status='접수', claim_number=`TKR-...`, refund_data=`{paid_token_amount, bonus_token_amount:0, refund_amount}`.
- **환불 취소 (고객)**: 접수 상태만 → '거부'로 전환.
- **환불 승인 (admin)**: Toss `POST /v1/payments/{paymentKey}/cancel` body `{cancelReason:'고객 토큰 환불 요청', cancelAmount?(부분일 때만, 생략=전액)}` → 성공 시: 음수 원장(type='refund', work_id `refund_{claim_id}_paid`, 원본 expires 승계) + 주문 status='취소' + 클레임 '접수→완료'. Toss 성공 후 DB 실패 = 수동 개입(원 동작 — 보상 트랜잭션 없음, 로그 명확히).
- **환불 가능 목록**: 완료 토큰 주문 + is_refundable/사유(expired/pending_refund/approved_refund/tokens_used/최신 아님).

## 7. 구매 확정·배치

- **고객 확정**: status ∈ {배송중, 배송완료}에서만, 활성 클레임 있으면 거부. → '완료'+confirmed_at, 로그 '고객 직접 구매확정'.
- **자동 확정 (배치)**: `배송완료 AND delivered_at <= now-7d` 또는 `배송중 AND (repair? company_shipped_at : shipped_at) <= now-7d`, 활성 클레임 없음. FOR UPDATE SKIP LOCKED. changed_by=NULL, memo `자동 구매확정 (... 7일 경과)`.
- **stale 취소 (배치)**: `대기중 AND created_at < now-30분` → '취소'. SKIP LOCKED. memo '자동 취소 (대기중 30분 초과)'. (원 스케줄 10분 주기.)
- **환불 계산**: 허용 상태(sale: 대기중/결제중/진행중, custom·repair·sample: +접수, token: 대기중/결제중)에서 `refund = total_price` 전액.

## 8. 주문 상태기계 (admin)

공통: 활성 클레임({접수,처리중,수거요청,수거완료,재발송}) 있으면 상태 변경 불가. 롤백이면 memo 필수. 로그(order_status_logs) 필수.

정방향:
- sale: 대기중→진행중→배송중→배송완료→완료. 취소 ← {대기중,결제중,진행중}
- custom: 대기중→접수→제작중→제작완료→배송중→배송완료→완료. 취소 ← {대기중,결제중,접수}
- sample: 접수→제작중→배송중→배송완료→완료. 취소 ← {대기중,결제중,접수}
- repair: {발송대기,발송중,발송확인중,수거예정}→접수→수선중→수선완료→배송중→배송완료→완료. 취소 ← {대기중,결제중,발송대기,발송중,발송확인중,수거예정} — 발송대기→접수는 §9 의도적 추가(고객 미등록 입고 시 관리자 강제 접수)
- token: 취소 ← {대기중,결제중}만. **완료는 결제 confirm 전용.**

롤백 (현재 상태가 {배송중,배송완료,완료,취소,수거완료,재발송}이면 불가):
- sale: 결제중→대기중, 진행중→대기중
- custom: 결제중→대기중, 접수→대기중, 제작중→접수, 제작완료→제작중
- sample: 결제중→대기중, 접수→대기중, 제작중→접수
- repair: 접수→(pickup? 수거예정 : no_tracking 영수증? 발송확인중 : 발송중), 수선중→접수, 수선완료→수선중
- token: 결제중→대기중

고객 액션(get_order_customer_actions): claim_cancel(sale{대기중,진행중}/custom{대기중,접수}/sample{대기중,접수}/repair{대기중,발송대기,발송중,발송확인중,수거예정}/token{대기중}), claim_return·claim_exchange(sale {배송중,배송완료}만), confirm_purchase(비-token, {배송중,배송완료}, 활성 클레임 없음).

## 9. 재구현 시 결정 사항 (원문과 의도적 차이)

- 스케줄러는 Cloud Scheduler → `POST /batch/*` (pg_cron 이미 제거된 상태였음).
- confirm 멱등 사전체크의 repair 상태는 RPC 권위 매핑(수거예정/발송대기)으로 통일 (엣지의 '발송대기' 고정은 버그였음).
- use_design_tokens의 p_quality 파라미터는 비용 미반영 vestigial — 제거.
- Toss 호출 금액은 항상 DB 재계산 합(원 동작 유지). 클라이언트 amount는 사전 일치 검증만.
- stale 대기중 주문 자동 취소 시 해당 주문 소유자의 예약 쿠폰을 `reserved→active`로 복원한다(원문은 쿠폰이 영구 잠기는 누락이 있었음).
- **repair 발송 확인 단순화 (원문과 의도적 차이 — UX 재검토로 결정)**: 결제 후 고객에게 필수로 받는 것은 "발송했다"는 확인뿐. 송장번호·사진은 선택 증빙(송장 있으면 발송중, 없으면 발송확인중 — 두 상태는 유지), no_tracking의 reason(quick/overseas/lost)은 선택화(원문은 필수). tracking 영수증에도 memo 허용. 고객이 아무 확인 없이 보낸 실물이 입고되면 관리자가 `발송대기→접수` 강제 전이(원문 전이표에는 없던 추가).
- **자동 대사 2겹 추가 (원문에 없던 보강 — 제품 관점 재검토로 결정)**:
  - confirm 재시도가 `ALREADY_PROCESSED_PAYMENT`를 받으면 실패(→unlock→stale 취소 = "돈 받고 주문 취소") 대신 **조회 API로 상태·orderId·금액 검증 후 DB 확정**.
  - `POST /payments/webhook`(공개): Toss 상태 변경 통지 수신. **페이로드 불신 — 조회 API 재검증**(Toss 공식 권장, Stripe식 HMAC 서명은 미제공) 후 불일치만 교정: 멈춘 '결제중' 확정 / 대시보드 직접 취소 동기화(+토큰 주문 지급분 회수, work_id `webhook_cancel_{order_id}` 멱등). 토큰 회수는 결제 그룹의 user id를 먼저 조회·정렬해 `USER_LOCK`을 잡은 뒤 order row를 잠그므로 `use_tokens`와 직렬화되고, 환불 경로의 공통 잠금 순서(USER → order)를 지킨다. 입력 `paymentKey`는 최대 200자이며, Toss 조회에서 4xx로 확인된 키는 인스턴스별 bounded TTL cache로 짧게 억제한다. IP 제한과 이 cache는 Cloud Run 인스턴스 내부 보조선이고, 전체 트래픽 제한은 Cloudflare WAF가 담당한다. 취소 동기화 전에는 조회 응답·저장 `paymentKey`와 총액이 모두 일치해야 한다. 부분취소·혼합상태·식별자/금액불일치는 자동 교정하지 않고 open `mixed_state` incident와 critical 로그로 남긴다(수동). 사용확정된 쿠폰 복원도 수동 정책. 조회 5xx만 5xx 응답으로 Toss 재시도 유도 — 그 외는 200 ack. 대시보드 웹훅 URL 등록은 스테이징 개통(4단계) 때.
