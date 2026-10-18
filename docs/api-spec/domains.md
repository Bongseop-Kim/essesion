# 도메인 동작 명세 — 인증·장바구니·클레임·견적·이미지

인증·배송지·장바구니·클레임·견적·이미지·admin 도메인의 **동작 정본**이다. 구현이 이 명세와 달라지면 버그다. 돈 경로는 [money.md](./money.md).

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
- 원문에 없던 **시도 횟수 락아웃 추가**: 검증 5회 실패(`MAX_VERIFY_ATTEMPTS`)면 `locked_at`을 찍고 해당 레코드를 잠근다 → `인증번호 시도 횟수를 초과했습니다. 새 인증번호를 요청해주세요.` 발급 제한과 5분 만료는 그대로.

Solapi 공통: `POST https://api.solapi.com/messages/v4/send`, 타임아웃 10초. 헤더 `Authorization: HMAC-SHA256 apiKey=.., date=<ISO now>, salt=<uuid>, signature=HMAC_SHA256(secret, date+salt) hex`. SMS body `{message:{to, from, text, type:"SMS"}}`. 알림톡 `type:"ATA"` + `kakaoOptions:{pfId, templateId, variables, disableSms:false}`(실패 시 SMS 자동 대체, text=fallback). 실패는 throw 없이 false.

- 배송 시작 알림톡(`SOLAPI_TEMPLATE_SHIPPING_STARTED`, 비면 미발송): 변수 `#{처리유형}`(sale 주문 / custom 주문 제작 / sample 샘플 제작 / repair 수선)·`#{주문번호}`·`#{택배사}`·`#{송장번호}`. fallback: `[ESSE SION] 접수하신 {처리유형} 상품의 배송이 시작되었습니다.\n주문번호 {주문번호}\n{택배사} {송장번호}\nhttps://essesion.shop/my-page/orders` (90바이트 초과라 LMS 대체). 발송 조건은 money.md §8.

## 2. 인증·프로필

- 소셜 **4종 구현**(`SUPPORTED_PROVIDERS = google, kakao, naver, apple`). Apple만 `response_mode=form_post`라 콜백이 **POST**(`POST /auth/apple/callback`)로 오며, form 본문 파싱(`python-multipart` 필수 — 없으면 콜백 전체가 죽는다)과 client-secret JWT 생성 경로를 포함한다. Apple의 동의창 취소는 form의 `error` 필드로 오므로 라우터가 직접 걸러낸다(authlib의 form_post 분기는 GET 분기와 달리 error를 보지 않는다). 미등록 provider는 `/readyz`의 `oauth_*` capability로 드러난다. scope: kakao `profile_nickname account_email`, google `openid email`. 네이버는 scope 파라미터가 없고 개발자센터 콘솔의 동의 항목(이름·이메일·네이버페이 배송지)이 제공 정보를 정한다.
- **네이버페이 배송지 연계**: 네이버 OAuth callback에서 `GET openapi.naver.com/v1/nid/payaddress`(방금 발급된 access token)로 대표 배송지를 1회 조회해, **저장 배송지가 0건인 사용자에게만** 기본 배송지로 수입한다(매핑: receiverName→recipient_name, zipCode→postal_code, baseAddress→address, detailAddress→address_detail, telNo→recipient_phone 정규화). 0건 확인과 INSERT는 사용자 advisory lock 안에서 직렬화한다. 미동의(403)·네이버페이 비회원(404)·유선번호·기타 실패는 전부 조용히 건너뛴다 — **배송지 실패가 로그인을 막으면 안 된다**. 네이버 토큰은 저장하지 않는다.
- **네이버앱 자동로그인**(개발가이드 §5.1): `GET /auth/naver/login?auth_type=autologin` — authorize URL에 `auth_type=autologin`을 붙인다(네이버 전용, 타 provider는 무시). 시도 조건은 store가 판단: 네이버앱 UA(`NAVER(inapp; search;`) + 과거 네이버 로그인 이력(localStorage) + 브라우저 세션당 1회(sessionStorage). provider가 오류(동의 취소·자동로그인 실패)로 콜백하면 `?provider=naver&error=access_denied`(아래 콜백 계약) — store는 자동로그인 시도였으면 조용히 홈으로, 수동 취소였으면 안내 후 로그인 페이지로.
- **소셜 콜백 계약**: OAuth 콜백은 브라우저 최상위 내비게이션의 종착지라 성공은 `{frontend_origin}/auth/callback?provider=<provider>`, 실패는 `{frontend_origin}/auth/callback?provider=<provider>&error=<code>`로 303하며 **어떤 실패도 JSON을 반환하지 않는다**(반환하면 API 콜백 URL에 응답 본문이 그대로 화면에 뜬다). code는 `access_denied`(provider 단계 — 동의 취소·자동로그인 실패·토큰 교환 실패) / `account_unavailable`(계정 단계 — 비활성·비고객 계정 거부) / `server_error`(그 외 전부; 상세는 서버 로그에만). store는 code로 문구를 고르고, Naver 자동로그인 pending은 provider가 `naver`인 콜백만 소진한다.
- 유저 생성 시 name 우선순위: 소셜 `name` → `full_name` → `nickname` → 이메일 로컬파트 → `'사용자'`. role은 항상 customer.
- 관리자 로그인: **이메일/비밀번호 전용**, role ∈ {admin, manager} 아니면 거부(`관리자 권한이 없습니다.`).
- 프로필 본인 수정 허용 필드: name, phone, birth, marketing_kakao_sms_consent만. phone_verified/notification_*/role은 전용 엔드포인트·관리자만.
- 알림 설정: notification_consent/enabled 부분 갱신, **변경 시에만** notification_preference_logs 기록. marketing 동의는 로그 없음.

## 3. 탈퇴 (delete-account)

- 원문: auth.users 하드 삭제 + FK CASCADE. images.uploaded_by는 SET NULL(레코드·스토리지 잔존 → 정리 배치 소관).
- 새 스키마: users 삭제 시 CASCADE는 배송지·장바구니·찜·인증·알림로그·identity·refresh. **주문·클레임·견적 등 이력은 NO ACTION** — 탈퇴 시 이력이 있으면: is_active=false 소프트 비활성 + 개인정보 필드 익명화, 이력 없으면 하드 삭제.

## 4. 클레임

- create: type ∈ {cancel, return, exchange}. reason ∈ {motif_change,motif_recolor,motif_position,target_missing,no_change}.
  - cancel 허용 주문 상태: sale{대기중,결제중,진행중} / custom{대기중,결제중,접수} / repair{대기중,결제중} / sample{대기중,결제중,접수}
  - return/exchange: 주문 상태 {배송중,배송완료} AND order_type ∈ {sale,repair,custom}
  - 수량: 기본 = 아이템 수량, 0 < qty ≤ 아이템 수량.
  - 중복 방지: 주문당 활성({접수,처리중,수거요청,수거완료,재발송}) 1건 + 아이템·타입당 1건(완료 포함) — 부분 unique 2종이 최후 방어(IntegrityError→한국어 메시지).
- cancel(고객): '접수' 상태만, **DELETE**(로그 CASCADE).
- admin 전이: cancel(접수→처리중→완료), return(접수→수거요청→수거완료→완료), exchange(접수→수거요청→수거완료→재발송→완료), 거부는 각 단계에서 가능(exchange는 재발송에서도). 롤백: `거부→접수`(전 타입) + cancel 처리중→접수, return/exchange 수거요청→접수. 롤백 memo 필수. 비활성→활성 재진입 시 주문당 단일 활성 가드 재검사.
- 알림(notify): 상태 {완료, 거부}만, 수신 조건 4종(notification_consent && phone_verified && notification_enabled && phone) 전부 충족 시 알림톡. claim_notification_logs UNIQUE(claim_id,status)로 1회 발송. 롤백 변경은 알림 안 함. fallback 문구:
  - 완료: `[ESSE SION] 클레임이 처리 완료되었습니다.\nhttps://essesion.shop/order/claim-list`
  - 거부: `[ESSE SION] 클레임 요청이 거부되었습니다. 자세한 내용은 아래 링크에서 확인해주세요.\n(동일 링크)`

## 5. 장바구니

- 전체 교체(replace): 유저 advisory lock → DELETE 전부 → 배열 재삽입. 빈 배열 = 비우기. 최대 50개이며 요청 내 `item_id`는 중복 불가·최대 200자다. product quantity는 양의 정수·최대 10,000, reform quantity는 1로 검증한다. product면 product_id 필수·reform_data 금지, reform이면 반대(제약). reform은 typed 옵션 검증 후 서버 현재 단가를 스냅샷하며, guest 이미지 claim token을 로그인 사용자에게 귀속하고 저장 데이터에서는 token을 제거한다.
- 부분 삭제: 중복 없는 item_id 배열(최대 50개)로 DELETE.
- 조회: created_at asc, 상품(옵션·좋아요 수·isLiked 포함)과 쿠폰(active_only면 사용 가능 쿠폰만) 조인.
- item_id는 클라이언트 합성 키이며 서버는 형식 의미를 해석하지 않지만 길이·요청 내 중복을 검증한다. DB는 UNIQUE(user_id, item_id)를 최후 방어로 둔다.

## 6. 배송지

- upsert 단일 엔드포인트: 유저 advisory lock → is_default=true면 **나머지 전부 해제** → id 없으면 INSERT, 있으면 본인 것 UPDATE. 개수 제한 없음.

## 7. 견적 (quotes)

- 생성: 100 ≤ quantity ≤ 10,000, options는 object(UTF-8 compact JSON 10KB 제한), contact_method ∈ {email, phone}, contact_name(최대 100자)/value(최대 320자) 필수, business_name 최대 200자, additional_notes 최대 500자, 배송지 본인 소유. reference_images는 최대 5개이며 object_key는 최대 1,024자, `kind=quote_request` 서명 URL 발급 시 생성한 본인 소유 스테이징 행만 허용한다. 발급 단계에서 선언 크기와 10MiB PUT 상한을 서명하고, 생성 시 GCS metadata(존재·MIME·실제 크기)를 선언값과 대조한 뒤 중복 INSERT 없이 `quote_request`로 재연결한다. `QUO-` 채번. status='요청'. 접수 알림톡(수신 조건 4종): `[ESSE SION] 견적 요청이 접수되었습니다.\n담당자가 순차적으로 연락드리겠습니다.`
- admin 전이: 요청→{견적발송,종료}, 견적발송→{협의중,종료}, 협의중→{확정,종료}. quoted_amount ≥ 0. quoted_amount/quote_conditions/admin_memo는 부분 갱신(coalesce). 로그 기록.
- **확정·종료 진입 시** 해당 견적 이미지 `expires_at = now()+90일`(기존 NULL만) — 구 트리거를 api 로직으로.

## 8. 이미지 (GCS — ImageKit 대체)

- 업로드: api가 GCS **서명 업로드 URL** 발급(엔드포인트가 object_key 결정) → 클라 업로드 → 도메인 엔티티에 재연결. 견적 이미지는 발급 시 본인 소유 스테이징 행을 만들고 선언 크기·10MiB PUT 상한을 서명하며 24시간 후 미귀속 행을 정리한다. 수선 사진은 비회원도 발급할 수 있으며 JPG/PNG/WebP·10MiB 상한, 15분 PUT URL, 24시간 claim token을 적용한다. 완료 등록에서 GCS metadata(size/content-type)를 검증하고, 로그인 장바구니 동기화 시 사용자 소유로 전환한다.
- 등록 종류: reform_upload / repair_shipping_upload(entity_id=file key, 부분 unique upsert — 소유자만 갱신), 범용 등록(entity_type별 소유권 검증: product=admin, quote_request/custom_order/reform=해당 엔티티 소유자). 팝업 배너는 `popup_upload → popup`(admin 전용, 공개 assets 버킷 — §10 팝업 공지).
- 재연결: 주문 생성 시 reform_upload→reform(entity_id=order_id), 수선 발송 제출 시 repair_shipping_upload→repair_shipping.
- 수기 주문 첨부(admin 전용): `manual_order_upload`(`uploads/manual_order_upload/`, TTL 24h, JPG/PNG/WebP·10MiB, 발급자=admin 본인) → 저장 시 `manual_order`(entity_id=수기주문 id, expires_at=NULL). 주문 단위 목록(`image_upload_ids`)과 품목별 목록(`items[].image_upload_ids`)을 합쳐 최대 5장씩 받고, 한 이미지는 한 곳에만 붙는다(중복 422). 등록·수정 요청은 **남길 이미지 전체 목록**이며 빠진 이미지는 `expires_at = now()`로 만료된다(삭제도 동일). 링크 시점에 GCS metadata를 재검증하고, 읽기는 소속 검증 뒤 서명 읽기 URL만 발급한다(다른 주문 이미지는 404).
- 수기 주문 확인 상태(admin 전용): `PATCH /admin/manual-orders/{id}/status`는 `is_confirmed`만 갱신한다(본문·이미지 목록 재전송 없음). 낙관적 잠금은 PUT과 동일 — `expected_updated_at`이 다르면 409 `stale_resource`. 자동수선 품목의 `wearer_height_cm`(키)은 선택·참고용이고 작업 기준값은 `total_length_cm`(넥타이 길이, 필수)이다.
- 만료: 미귀속 수선 업로드와 장바구니에서 제거·교체된 수선 업로드는 +24시간, 견적 확정·종료는 +90일(§7). 주문에 연결되거나 로그인 장바구니에서 사용 중인 수선 이미지는 NULL. 정리 배치: `deleted_at IS NULL AND (expires_at < now() OR deletion_claimed_at IS NOT NULL)` 배치 100건 — ①claim(deletion_claimed_at=now) ②GCS 삭제 ③성공분 deleted_at=now (2단계 멱등 삭제).

## 9. 수선 발송 제출 (고객)

- submit_tracking: 택배사 코드 `^[a-z0-9_-]{1,30}$`, 송장 필수, 사진 최대 3장. 주문 status='발송대기'에서만 → '발송중' + shipped_at=now + 로그 `고객 발송 처리: <code> <tracking>` + 사진 재연결 + repair_shipping_receipts(receipt_type='tracking').
- submit_no_tracking: reason ∈ {quick, overseas, lost}, memo ≤ 500자 → '발송확인중' + 로그 + receipts(receipt_type='no_tracking').

## 10. admin 기타

- 송장 갱신: 일반(courier/tracking/shipped_at)·기업(company_*) 2종 부분 갱신. tracking 신규 입력 시 `shipped_at = coalesce(기존, now())`, 비우면 NULL. status ∈ {배송완료, 완료, 취소}면 거부.
- 쿠폰 일괄 발급: user_coupons upsert(ON CONFLICT (user,coupon) DO UPDATE status='active' — 재활성화). 회수: **active만** revoked로 (id 목록 / 쿠폰×유저 목록 2종).
- 통계: 오늘(주문 수·매출 합, 타입 필터 all|sale|custom|repair|sample), 기간(start≤end, created_at 범위).
- **대시보드 집계 기준** (`/admin/dashboard/overview`, `/admin/dashboard/recent-orders`):
  - 주문(`orders`)의 매출 시각은 `paid_at`이 유일한 기준이며 KST 일 단위로 버킷한다.
  - **수기 주문(`manual_orders`)도 주문 수·매출 합·매출 추이에 합산한다.** 수기 주문에는
    `paid_at`이 없으므로 `is_paid = true`인 행만, `order_date`(이미 KST date)를 매출일로 본다.
    금액은 `amount - discount + shipping_fee`(실수령액) — `orders.total_price`가 배송비를
    포함하므로 같은 기준이다.
  - 대시보드 타입 필터는 위 목록에 `manual`을 더한 6종이다. `manual`은 `orders.order_type`이
    아니라 별도 장부를 가리키므로 **주문 목록(`/admin/orders`) 필터에는 없다**. `manual`을 고르면
    `recent-orders`는 빈 페이지를 반환하고, 대시보드가 `/admin/manual-orders`를 따로 조회해
    자기 표에 그린다.
  - 매출 추이(`timeseries.points`)는 일별 매출을 **유형 6종으로 분해**해 함께 내려준다:
    `sale_amount`·`custom_amount`·`repair_amount`·`sample_amount`(각각
    `orders.order_type`) + `manual_custom_amount`·`manual_repair_amount`. **6종의 합은 항상
    `order_amount`와 같다.** 수기 주문은 금액이 주문 단위라 품목 배분 근거가 없어 **주문 단위**로
    분류한다 — 품목 중 하나라도 주문제작(`items[].custom`)이 있으면 `manual_custom`, 아니면
    `manual_repair`다. 타입 필터를 걸면 해당 유형 외 구획은 0이 된다.
  - 인기 상품 TOP-N은 `order_items.product_id` 기준이라 커스텀·수선과 함께 수기 주문도 제외된다
    (수기 주문 품목은 JSONB이고 product_id가 없다).
- 상품 옵션 전체 교체(admin): DELETE 후 재삽입, **옵션 ≥1개면 products.stock=NULL 강제**(옵션 재고 관리로 전환).
- 템플릿 큐레이션: `GET /admin/design/examples`, `PATCH·DELETE /admin/design/examples/{id}`(게시·순서·삭제). 템플릿은 시드 코드로만 만든다(admin 등록 없음). 템플릿 데이터(`category`·`point`·`logo_slots`·`photo_full_url`·`photo_detail_url`)는 시드 코드(`apps/worker/scripts/seed_design_examples.py`)가 정본이라 admin 본문으로 받지 않는다 — 응답에는 노출된다.
- **팝업 공지**(store 첫 진입 기간 한정 안내): `GET·POST /admin/popups`, `PATCH·DELETE /admin/popups/{id}`, 배너 이미지 `POST /admin/popups/images/upload-url` → `POST /admin/popups/images/{upload_id}/complete` → 저장 시 연결, `DELETE /admin/popups/images/{upload_id}`(스테이징 만료). 공개 조회 `GET /popups/active`는 `enabled`이고 **KST 오늘**이 `starts_on ≤ 오늘 ≤ ends_on`인 행 중 `starts_on desc, created_at desc` 첫 1건을 주고, 없으면 200 + `null`. 공개 응답은 렌더에 필요한 것만(id·template·title·title_emphasis·body·fields·link_url) — 기간·활성 여부는 admin 응답(`active_now` 계산값 포함)에만 있다.
  - 템플릿은 `fields.template`으로 판별하는 3종: `holiday`(cutoff_on·cutoff_time `HH:MM`·closed_from·closed_to·resume_on·footnote — `cutoff_on ≤ closed_from ≤ closed_to < resume_on` 아니면 422; store가 이 날짜로 달력·범례를 그린다) · `operation`(rows[{label ≤20자, value ≤80자}] 1–4행·footnote) · `event`(image_upload_id — 본인이 완료 등록한 `popup_upload` 행만, 아니면 422 `invalid_popup_image`/`popup_image_not_completed`; `link_url` 필수 422 `popup_link_required`).
  - 공통 검증: `ends_on < starts_on` 422 `invalid_popup_period`(PATCH는 병합 뒤 검증), `link_url`은 `/`로 시작하는 내부 경로 또는 `https://`만, `body`는 평문에 `**굵게**` 마크만 허용(store가 해석). PATCH에서 생략은 "안 바꿈", null은 "지움", `fields`는 통째로 교체.
  - 이미지: 상품 이미지와 같은 규칙(공개 assets 버킷, `popups/` 접두, JPG/PNG/WebP·10MiB, 24시간 TTL). 저장 시 `popup_upload → popup(entity_id=팝업 id, expires_at=NULL)`, 교체·템플릿 변경·팝업 삭제로 빠진 이미지는 `expires_at = now()`로 만료돼 정리 배치가 지운다. 등록 직후는 `enabled=false`.

## 11. 디자인(`/design`) 엔드포인트

고객 흐름은 템플릿 고르기 → 색·로고 → 바로 주문하기다(2026-10-19 AI 디자인 생성·디자인 토큰 종료). 색은 store가 SVG에서 바꾸고, 꾸민 디자인은 store가 PNG로 만들어 맞춤 주문 참고 이미지(`custom_order`, §8·money.md §3)로 올린다. 아래가 남은 표면 전부이며 모두 무료다.

| 엔드포인트 | 역할 |
|---|---|
| `GET /design/examples` | 템플릿 목록(게시된 것, **공개 조회**). 템플릿 데이터 `category`(필터 칩 라벨)·`point`(`none\|top\|bottom`, 포인트 로고 자리)·`logo_slots`(`[{slot: 1\|2\|"logo", label}]` — 로고를 받을 자리, 순서대로 색·로고 화면의 업로드 칸. 템플릿이 안 정했으면 아래 서버 규칙 한 자리)·`photo_full_url`·`photo_detail_url`(실사 사진, 없으면 store가 결정론 샷)·`logo_preview_svg`(첫 로고 자리 모티프 미리보기 — 템플릿이 자리를 안 정했으면 panel 로고. 세션 `current_motifs[].preview_svg`와 같은 형식, 없으면 null)·`panel_svg`(배치형 요소 SVG, 반복형은 null)·`logo_in_panel`(포인트 로고를 panel이 그린다 — store는 엠블럼 오버레이를 얹지 않는다)·`colorways[]`(run intent의 `{id,name,mapping}` 그대로 — 템플릿은 `default`만 둔다. 색 고르기 부위는 intent 팔레트의 이름 붙은 슬롯) |
| `POST /design/sessions/from-example` | 템플릿 run을 새 세션의 시작점으로 복원(`{example_id}`) — 렌더·워커 호출 없음. 세션에 `example_id`가 남고 세션 응답에 노출된다(템플릿 삭제 시 null) |
| `GET /design/sessions/{id}` | 세션 단건. `preview_svg`(편집 포인터 = 마지막 activate 런의 디자인 SVG, 없으면 null)·`preview_panel_svg`(같은 런의 배치형 panel SVG — [worker-engine.md](./worker-engine.md) §2b, 없으면 null)·`current_motifs`·`active_generation_*`(진행 중 재렌더 — store가 폴링으로 복원) |
| `POST /design/sessions/{id}/logo` | 로고 넣기(`{name, svg, slot?}`) — 내 모티프로 저장(content-hash로 멱등, 계정당 100개)한 뒤 그 자리의 모티프를 교체해 결정적 재렌더. 자리는 세션 템플릿(`example_id`)의 `logo_slots` 중 `slot`(생략하면 첫 자리), 없는 자리면 저장 전에 422(`invalid_logo_slot`). 템플릿이 자리를 안 정했으면 서버 규칙 한 자리 — intent에 배치형 panel 로고(`role=logo`)가 있으면 그 자리(워커 `motif_slot.slot="logo"`, 턴 `slot:"logo"`), 아니면 모티프 슬롯이 둘이면 2, 아니면 1. 진행 중 재렌더가 있으면 409(`generation_in_progress`) |
| `POST /design/motifs/photo-preview` | 사진 → SVG 변환(워커 로컬 VTracer, [worker-motifs.md](./worker-motifs.md) §7.1). 사진은 `POST /images/upload-url`(`kind=design_reference`) → `POST /design-uploads/{id}/complete`로 먼저 올린다 |

**역할 명시**: 정본은 intent JSON + 결정론 타일이다. 직조 실현 가능성 판단은 원단 디자이너(사람)의 영역이며 시스템은 이를 자동 판정하지 않는다.

폐기된 엔드포인트(2026-10-19): 세션 생성·목록·삭제, 턴, `/design/generate`, `steps/activate`, 모티프 검색·생성·교체·라이브러리, `text-preview`, `ideas`, `finalize`, `export`, `/design/jobs*`, `/color`. 그 이전: `select`·`reroll`·`branch`.

## 12. 에러 메시지 계약

기존 P0001 한국어 메시지는 프론트 노출 문자열 — 그대로 보존(detail 필드). 대표: `유효하지 않은 휴대폰 번호입니다`, `1분 후 재전송 가능합니다`, `오늘 인증 시도 횟수를 초과했습니다`, `인증번호가 만료되었습니다`, `인증번호가 일치하지 않습니다`, `인증번호 시도 횟수를 초과했습니다. 새 인증번호를 요청해주세요.`, `현재 주문 상태에서는 취소할 수 없습니다`, `활성 클레임이 있는 주문은 주문 상태를 직접 변경할 수 없습니다`, `롤백 시 사유 입력 필수`, `접수 상태에서만 클레임을 취소할 수 있습니다`, `발송대기 상태에서만 송장번호를 등록할 수 있습니다`, `딤플은 자동 봉제(AUTO)에서만 선택 가능합니다`, `관리자 권한이 없습니다.` 등 — 각 도메인 구현 시 원문 사용.
