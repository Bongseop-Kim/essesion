# 도메인 동작 명세 (YeongSeon 추출 — 구현 기준)

원본: YeongSeon `supabase/schemas/{91_utils,92_cart,94_claims,96_quotes,97_admin,11_shipping,86_design_tokens,88_images,10_profiles}.sql`, `supabase/functions/{send-phone-verification,verify-phone,delete-account,notify-claim,create-quote-request}`, `apps/store` 인증 플로우. 돈 경로는 [money.md](./money.md).

## 1. 휴대폰 인증

발급 (send):
- 입력 phone → 하이픈 제거 → `^01[0-9]{8,9}$` 검증(위반: `유효하지 않은 휴대폰 번호입니다`).
- OTP: 암호학적 난수 6자리(앞자리 0 허용).
- 제한(유저 advisory lock으로 직렬화): 최근 발급 후 **60초** 미만 → `1분 후 재전송 가능합니다`(429), 당일(로컬 자정 기준) **5회** 이상 → `오늘 인증 시도 횟수를 초과했습니다`(429).
- 만료 = 발급 +**5분**. Solapi SMS 본문: `[ESSE SION] 인증번호는 [{code}]입니다. 5분 내에 입력해주세요.`
- SMS 발송 실패 시 방금 만든 레코드 **삭제**(카운트 미소모) 후 502 `문자 발송에 실패했습니다. 다시 시도해주세요.`

검증 (verify):
- 최신 미사용(verified=false) 레코드 1건. 없으면 `인증번호를 다시 요청해주세요`, 만료 `인증번호가 만료되었습니다`, 불일치(**timing-safe 비교**) `인증번호가 일치하지 않습니다`.
- 성공: verified=true + **users.phone=정규화폰 + phone_verified=true** 갱신.
- 원문에 시도 횟수 락아웃 없음(발급 제한+5분 만료가 방어) — 동일 유지.

Solapi 공통: `POST https://api.solapi.com/messages/v4/send`, 타임아웃 10초. 헤더 `Authorization: HMAC-SHA256 apiKey=.., date=<ISO now>, salt=<uuid>, signature=HMAC_SHA256(secret, date+salt) hex`. SMS body `{message:{to, from, text, type:"SMS"}}`. 알림톡 `type:"ATA"` + `kakaoOptions:{pfId, templateId, variables, disableSms:false}`(실패 시 SMS 자동 대체, text=fallback). 실패는 throw 없이 false.

## 2. 인증·프로필

- 소셜: **Google, Kakao만 활성**(원문도 동일 — naver/apple 버튼 비활성). scope: kakao `profile_nickname account_email`, google `openid email`.
- 유저 생성 시 name 우선순위: 소셜 `name` → `full_name` → `nickname` → 이메일 로컬파트 → `'사용자'`. role은 항상 customer. 초기 토큰 지급(money.md §6, 실가입자만).
- 관리자 로그인: **이메일/비밀번호 전용**, role ∈ {admin, manager} 아니면 거부(`관리자 권한이 없습니다.`).
- 프로필 본인 수정 허용 필드: name, phone, birth, marketing_kakao_sms_consent만. phone_verified/notification_*/role은 전용 엔드포인트·관리자만.
- 알림 설정: notification_consent/enabled 부분 갱신, **변경 시에만** notification_preference_logs 기록. marketing 동의는 로그 없음.

## 3. 탈퇴 (delete-account)

- 원문: auth.users 하드 삭제 + FK CASCADE. images.uploaded_by는 SET NULL(레코드·스토리지 잔존 → 정리 배치 소관).
- 새 스키마: users 삭제 시 CASCADE는 배송지·장바구니·찜·인증·알림로그·identity·refresh. **주문·클레임·견적·토큰 등 이력은 NO ACTION** — 탈퇴 시 이력이 있으면: is_active=false 소프트 비활성 + 개인정보 필드 익명화, 이력 없으면 하드 삭제. (스키마 재설계에 따른 명시 처리 — MAPPING.md §1)

## 4. 클레임

- create: type ∈ {cancel, return, exchange}(token_refund는 토큰 환불 플로우 전용). reason ∈ {change_mind, defect, delay, wrong_item, size_mismatch, color_mismatch, other}.
  - cancel 허용 주문 상태: sale{대기중,결제중,진행중} / custom{대기중,결제중,접수} / repair{대기중,결제중} / sample{대기중,결제중,접수} / token{대기중}
  - return/exchange: 주문 상태 {배송중,배송완료} AND order_type ∈ {sale,repair,custom}
  - 수량: 기본 = 아이템 수량, 0 < qty ≤ 아이템 수량.
  - 중복 방지: 주문당 활성({접수,처리중,수거요청,수거완료,재발송}) 1건 + 아이템·타입당 1건(완료 포함) — 부분 unique 2종이 최후 방어(IntegrityError→한국어 메시지).
- cancel(고객): '접수' 상태만, **DELETE**(로그 CASCADE).
- admin 전이: cancel(접수→처리중→완료), return(접수→수거요청→수거완료→완료), exchange(접수→수거요청→수거완료→재발송→완료), 거부는 각 단계에서 가능(exchange는 재발송에서도). token_refund는 접수→거부만(완료는 승인 플로우 전용). 롤백: `거부→접수`(전 타입) + cancel 처리중→접수, return/exchange 수거요청→접수. 롤백 memo 필수. 비활성→활성 재진입 시 주문당 단일 활성 가드 재검사.
- 알림(notify): 상태 {완료, 거부}만, 수신 조건 4종(notification_consent && phone_verified && notification_enabled && phone) 전부 충족 시 알림톡. claim_notification_logs UNIQUE(claim_id,status)로 1회 발송. 롤백 변경은 알림 안 함. fallback 문구:
  - 완료: `[ESSE SION] 클레임이 처리 완료되었습니다.\nhttps://essesion.shop/order/claim-list`
  - 거부: `[ESSE SION] 클레임 요청이 거부되었습니다. 자세한 내용은 아래 링크에서 확인해주세요.\n(동일 링크)`

## 5. 장바구니

- 전체 교체(replace): 유저 advisory lock → DELETE 전부 → 배열 재삽입. 빈 배열 = 비우기. product quantity는 양의 정수, reform quantity는 1로 검증한다. product면 product_id 필수·reform_data 금지, reform이면 반대(제약). reform은 typed 옵션 검증 후 서버 현재 단가를 스냅샷하며, guest 이미지 claim token을 로그인 사용자에게 귀속하고 저장 데이터에서는 token을 제거한다.
- 부분 삭제: item_id 배열로 DELETE.
- 조회: created_at asc, 상품(옵션·좋아요 수·isLiked 포함)과 쿠폰(active_only면 사용 가능 쿠폰만) 조인.
- item_id는 클라이언트 합성 키(서버는 검증 안 함, UNIQUE(user_id, item_id)).

## 6. 배송지

- upsert 단일 엔드포인트: 유저 advisory lock → is_default=true면 **나머지 전부 해제** → id 없으면 INSERT, 있으면 본인 것 UPDATE. 개수 제한 없음.

## 7. 견적 (quotes)

- 생성: quantity ≥ 100, options는 object(10KB 제한), contact_method ∈ {email, phone}, contact_name/value 필수, 배송지 본인 소유. reference_images는 최대 5개이며 `kind=quote_request` 서명 URL 발급 시 생성한 본인 소유 스테이징 행만 허용한다. 발급 단계에서 선언 크기와 10MiB PUT 상한을 서명하고, 생성 시 GCS metadata(존재·MIME·실제 크기)를 선언값과 대조한 뒤 중복 INSERT 없이 `quote_request`로 재연결한다(DryRun은 발급된 스테이징 행을 업로드 증명으로 사용). `QUO-` 채번. status='요청'. 접수 알림톡(수신 조건 4종): `[ESSE SION] 견적 요청이 접수되었습니다.\n담당자가 순차적으로 연락드리겠습니다.`
- admin 전이: 요청→{견적발송,종료}, 견적발송→{협의중,종료}, 협의중→{확정,종료}. quoted_amount ≥ 0. quoted_amount/quote_conditions/admin_memo는 부분 갱신(coalesce). 로그 기록.
- **확정·종료 진입 시** 해당 견적 이미지 `expires_at = now()+90일`(기존 NULL만) — 구 트리거를 api 로직으로.

## 8. 이미지 (GCS — ImageKit 대체)

- 업로드: api가 GCS **서명 업로드 URL** 발급(엔드포인트가 object_key 결정) → 클라 업로드 → 도메인 엔티티에 재연결. 견적 이미지는 발급 시 본인 소유 스테이징 행을 만들고 선언 크기·10MiB PUT 상한을 서명하며 24시간 후 미귀속 행을 정리한다. 수선 사진은 비회원도 발급할 수 있으며 JPG/PNG/WebP·10MiB 상한, 15분 PUT URL, 24시간 claim token을 적용한다. 완료 등록에서 GCS metadata(size/content-type)를 검증하고, 로그인 장바구니 동기화 시 사용자 소유로 전환한다.
- 등록 종류: reform_upload / repair_shipping_upload(entity_id=file key, 부분 unique upsert — 소유자만 갱신), 범용 등록(entity_type별 소유권 검증: product=admin, quote_request/custom_order/reform=해당 엔티티 소유자).
- 재연결: 주문 생성 시 reform_upload→reform(entity_id=order_id), 수선 발송 제출 시 repair_shipping_upload→repair_shipping.
- 만료: 미귀속 수선 업로드와 장바구니에서 제거·교체된 수선 업로드는 +24시간, 견적 확정·종료는 +90일(§7). 주문에 연결되거나 로그인 장바구니에서 사용 중인 수선 이미지는 NULL. 정리 배치: `deleted_at IS NULL AND (expires_at < now() OR deletion_claimed_at IS NOT NULL)` 배치 100건 — ①claim(deletion_claimed_at=now) ②GCS 삭제 ③성공분 deleted_at=now (2단계 멱등 삭제).

## 9. 수선 발송 제출 (고객)

- submit_tracking: 택배사 코드 `^[a-z0-9_-]{1,30}$`, 송장 필수, 사진 최대 3장. 주문 status='발송대기'에서만 → '발송중' + shipped_at=now + 로그 `고객 발송 처리: <code> <tracking>` + 사진 재연결 + repair_shipping_receipts(receipt_type='tracking').
- submit_no_tracking: reason ∈ {quick, overseas, lost}, memo ≤ 500자 → '발송확인중' + 로그 + receipts(receipt_type='no_tracking').

## 10. admin 기타

- 송장 갱신: 일반(courier/tracking/shipped_at)·기업(company_*) 2종 부분 갱신. tracking 신규 입력 시 `shipped_at = coalesce(기존, now())`, 비우면 NULL. status ∈ {배송완료, 완료, 취소}면 거부.
- 쿠폰 일괄 발급: user_coupons upsert(ON CONFLICT (user,coupon) DO UPDATE status='active' — 재활성화). 회수: **active만** revoked로 (id 목록 / 쿠폰×유저 목록 2종).
- 통계: 오늘(주문 수·매출 합, 타입 필터 all|sale|custom|repair|token|sample), 기간(start≤end, created_at 범위).
- 상품 옵션 전체 교체(admin): DELETE 후 재삽입, **옵션 ≥1개면 products.stock=NULL 강제**(옵션 재고 관리로 전환).

## 11. 에러 메시지 계약

기존 P0001 한국어 메시지는 프론트 노출 문자열 — 그대로 보존(detail 필드). 대표: `유효하지 않은 휴대폰 번호입니다`, `1분 후 재전송 가능합니다`, `오늘 인증 시도 횟수를 초과했습니다`, `인증번호가 만료되었습니다`, `인증번호가 일치하지 않습니다`, `현재 주문 상태에서는 취소할 수 없습니다`, `활성 클레임이 있는 주문은 주문 상태를 직접 변경할 수 없습니다`, `롤백 시 사유 입력 필수`, `접수 상태에서만 클레임을 취소할 수 있습니다`, `발송대기 상태에서만 송장번호를 등록할 수 있습니다`, `딤플은 자동 봉제(AUTO)에서만 선택 가능합니다`, `관리자 권한이 없습니다.` 등 — 각 도메인 구현 시 원문 사용.
