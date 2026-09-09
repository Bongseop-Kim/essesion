# 휴대폰 인증 유도 2단계 + 배송중 알림톡

**전제**: 2026-09-09에 카카오 알림톡 템플릿 1종(배송 시작)이 신규 승인됐다. 프론트 항목(1~4)은
지금 실행 가능하다. 백엔드 항목(5~8)은 **버튼 유형과 PFID를 확인한 뒤** 실행한다(아래 실행 조건).

관련: `docs/reviews/alimtalk-templates-2026-08-14.md`(알림톡 2종 추가 때의 결정·미검증 항목),
`docs/api-spec/domains.md §1`(Solapi 공통 계약), `docs/api-spec/money.md §8`(주문 상태기계).

2026-09-09 검토 메모: 초안의 api 경로는 `domains/` 접두가 빠져 있었다(`orders/service.py` →
`apps/api/src/api/domains/orders/service.py`). 아래 경로는 전부 실재 확인했다. 초안의 "가입 직후 모달 +
결제 버튼 인터셉트 + 거절 카운터" 구조는 기각한 대안으로 내렸다 — 근거는 항목 4와 기각한 대안 참조.

## 왜 필요한가

세 가지가 동시에 비어 있다.

1. **인증 유도가 마이페이지 안쪽 3곳뿐이고, 주문 시점에는 없다.**
   `apps/store/src/pages/my-page/index.tsx:75`의 캡션, `my-page/my-info/index.tsx:147`의 `인증`/`변경`
   버튼, `my-page/my-info/notice.tsx:113`의 Callout + 알림 스위치. 셋 다 사용자가 마이페이지를 스스로
   찾아 들어가야 보인다. 근거: 인증 API를 호출하는 컴포넌트는 레포 전체에서
   `features/my-page/ui/phone-verify-modal.tsx` 하나뿐이고, 이를 import하는 곳은 위 my-info 2개
   페이지뿐이다(2026-09-09 확인). 주문서에서 받는 휴대폰 번호는 배송지 수령인 연락처
   (`features/shipping/ui/address-form-fields.tsx:82`)로 인증과 무관하다.
2. **인증만 해도 카톡이 안 간다.** 수신 조건은 4개 전부 충족이고
   (`domains/claims/service.py:295`, `domains/payments/service.py:587`, `domains/quotes/router.py:30`),
   `notification_consent`의 기본값은 **false**다(`db/src/db/models/auth.py:28`). 이 값을 켜는
   경로는 `notice.tsx:38`의 스위치 하나뿐이라, 인증만 시키고 끝내면 알림은 여전히 안 간다.
   참고: 배송 현황은 카카오 기준 **정보성** 메시지라 법적으로는 수신동의가 필요 없다
   (kakaobusiness 가이드 "알림톡 유형"). 4조건 게이트는 기존 알림과의 일관성을 위한 **제품 선택**이고,
   이 플랜은 그 선택을 바꾸지 않는다.
3. **배송 알림이 없다.** 알림톡은 5종(클레임 완료·거부, 견적 접수, 인증번호, 결제완료 —
   `apps/api/src/api/config.py:71-75`)뿐이고, 고객이 가장 궁금해하는 "발송됐나"에 해당하는 알림이
   없다. `domains/orders/service.py:1026 admin_update_status`는 상태 로그만 쓰고 발송 훅이 없다.

## 범위 밖(non-goals)

- 배송완료·제작중 등 다른 상태의 알림. 이 플랜은 **배송중 진입 1종**만 붙인다.
- 알림 발송 이력 테이블·outbox (항목 7의 1회성 근거 참조).
- 마케팅 수신 동의 흐름(별도 동의, 별도 문구).
- 거절 카운터·"묻지 않음" 플래그·로그인 직후 모달 — 기각한 대안 참조. 유도 UI는 전부 **인라인·비차단**이라
  거절 상태를 저장할 게 없다.
- admin 택배사 입력의 select 전환 — 상향 신호에만 적는다.
- 프롬프트 노출·클릭 계측. 필요해지면 `docs/analytics.md` 규약대로 나중에 붙인다.

## 실행 조건

**확보됨** (2026-09-09 전달) — 템플릿 ID `KA01TP260902084020286DuSAS1joyKs`, 변수 4개
`#{처리유형}`·`#{주문번호}`·`#{택배사}`·`#{송장번호}`(래퍼 포함 표기가 승인본), 승인 본문:

```
주문번호   #{주문번호}
택배사     #{택배사}
송장번호   #{송장번호}

안녕하세요, 고객님.
ESSE SION에서 접수하신 #{처리유형} 상품의 배송이 시작되었습니다.

배송 진행 상황은 아래에서 확인하실 수 있습니다.

감사합니다 :)
```

`#{처리유형}`은 "접수하신 ○○ 상품" 자리에 들어가는 명사구다 — 항목 7의 매핑이 이 문장에 맞춰져 있다.

남은 확인 2개(백엔드 항목 실행 전, 카카오 비즈니스 채널 관리자센터 → 알림톡 템플릿 상세에서 본다):

1. **PFID** — 기존 `solapi_pf_id`(`integrations/solapi.py:41`, `:132`; prod 값
   `KA01PF2603241454215603Q1FT5wP6MD`)와 같으면 항목 6을 건너뛴다. 다르면 항목 6을 포함시킨다.
2. **버튼 유형** — "아래에서 확인"이 가리키는 버튼이 셋 중 무엇인지에 따라 항목 7의 변수 처리가 갈린다.
   - **DS(배송조회)**: 카카오가 **본문의 택배사명·송장번호를 파싱**해 택배사 조회 페이지로 연결한다.
     추가 변수는 없다. 대신 `#{택배사}` 값이 카카오가 인식하는 택배사 명칭이어야 버튼이 동작한다
     (지원 목록: 우체국택배·로젠택배·한진택배·롯데택배·경동택배·CJ대한통운 등 — 카카오 지원 목록은
     바뀌므로 실 발송 때 확인). 인식 실패 시 메시지는 가되 버튼만 빠진다 — 상향 신호 참조.
   - **WL(웹링크) 고정 URL**: 추가 작업 없음. `variables` 4개로 끝난다.
   - **WL 변수 URL**(`https://essesion.shop/#{경로}` 형태): 5번째 변수가 되므로 `variables`에 함께 넣는다.
     카카오는 프로토콜 부분 고정 + 경로 변수를 허용한다(카카오 데브톡 135761, 비즈뿌리오 가이드).
     Solapi가 이 변수를 `variables`로 치환하는지 `kakaoOptions.buttons`로 따로 넘겨야 하는지는 문서에
     명시가 없다 — 이 경우에만 Solapi 고객센터에 확인하고 실행한다.

확인이 안 되면 **백엔드 항목을 실행하지 말고** 프론트 항목(1~4)만 먼저 내보낸다. 프론트는 알림톡
템플릿과 독립이다.

## 절차

### A. 프론트 — 인증 유도 (항목 1~4)

1. **미인증의 손실을 문구로 명시한다.** 3곳: `my-page/index.tsx:77`,
   `my-page/my-info/notice.tsx:114`(Callout title·description),
   `features/my-page/ui/phone-verify-modal.tsx:100`(Modal description). 현행 문구는 "인증하면 받을
   수 있습니다"라 미인증 상태의 손실이 드러나지 않는다. "인증하지 않으면 주문·배송 진행 상태를
   카카오톡으로 받을 수 없다"를 각 문구에 넣는다. 2~3문장 이내로 — 소프트 프롬프트 문구 권고
   (Appcues permission priming 가이드).

2. **인증 성공 시 서비스 알림을 함께 켠다.** 아래 항목 3 컴포넌트의 `onVerified`에서
   `setNotificationPreferencesMutation`으로 `notification_consent`·`notification_enabled`를 true로
   —`notice.tsx:38-51`이 이미 쓰는 패턴 그대로. 근거: 위 "왜 필요한가" 2. 이걸 빼면 인증을
   통과한 사용자도 알림을 못 받는다. 기존 my-info의 `인증` 버튼은 건드리지 않는다(거기서는 알림
   스위치가 따로 있다).

3. **인라인 유도 컴포넌트.** `features/my-page/ui/phone-prompt-callout.tsx` 신규. `Callout`(shared) +
   `[인증하기]` 액션 1개. `인증하기`는 기존 `PhoneVerifyModal`(`open`·`onOpenChange`·`onVerified` props,
   `phone-verify-modal.tsx:8-16`)을 그대로 연다 — 새 인증 UI를 만들지 않는다. 문구는
   "주문·배송 진행 상황을 카카오톡으로 안내해드립니다" + 미인증 시의 손실(항목 1). 렌더 조건은
   `session.user && !user.phone_verified` 하나. 닫기 버튼·거절 저장 없음 — 인라인 Callout은 결제를
   막지 않으므로 "몇 번 물었나"를 셀 이유가 없다.

4. **노출 지점 2개 — 주문서와 결제완료 화면, 둘 다 인라인.**
   - **A. 주문서** `pages/order/order-form.tsx:318` `ShippingAddressCard` 바로 아래. 배송지 옆이
     "이 주문의 배송을 카톡으로 받는다"는 가치 제안이 가장 자연스러운 자리다. **결제 버튼
     (`features/checkout/ui/checkout-shell.tsx:68 onPay`)은 건드리지 않는다** — 결제 진입은 그대로다.
   - **B. 결제완료 화면** `pages/order/payment-success.tsx` 결제 확정 안내 아래. 주문 직후는 "이제
     배송 알림을 받고 싶다"가 성립하는 두 번째 맥락이고, 주문서에서 지나친 사용자를 이탈 위험 없이 한 번
     더 받는다.
   - 근거(웹 조사 2026-09-09): 권한·수신동의 요청은 **기능을 쓰는 맥락에서** 물을 때 허용률이 높고
     앱 진입 시 묻는 모달은 낮다(web.dev "Permissions best practices", Appcues priming 가이드 — 지연
     요청이 28% 높은 허용률). 커머스 SMS 옵트인도 팝업이 아니라 **체크아웃 페이지 안의 인라인 옵트인 +
     "주문 업데이트" 가치 제안**이 정석이다(Omnisend·Rejoiner·Salesmsg 옵트인 가이드).
   - 토큰 구매(`token/purchase/payment`)는 붙이지 않는다 — 배송이 없다(`status_machine.py:40`의
     `token: set()`).
   - 커스텀·샘플 결제 페이지(`order/custom-payment`, `order/sample-payment`)도 붙이지 않는다. 둘 다
     결제완료 화면(B)을 지나므로 B가 덮는다.

### B. 백엔드 — 배송중 알림톡 (항목 5~8)

5. **설정 추가.** `apps/api/src/api/config.py:75` 아래
   `solapi_template_shipping_started: str = ""  # 비면 배송중 알림을 건너뛴다`.
   **`build_solapi_client`의 `required`(`integrations/solapi.py:128`)에는 넣지 않는다** — 넣으면 이 값
   하나가 비었을 때 prod에서 알림톡 전체가 `UnavailableSolapiClient`로 떨어진다. 기존
   `phone_code`·`payment_done`도 같은 이유로 빠져 있다.

6. **(PFID가 기존과 다를 때만)** `send_alimtalk`에 `pf_id: str | None = None` 인자를 더해
   `kakaoOptions.pfId`를 오버라이드한다. `SolapiClient` Protocol과 DryRun·Unavailable 구현 3곳을 함께
   고친다. 같으면 이 항목은 실행하지 않는다.

7. **발송 훅 — 상태와 송장이 모두 채워진 시점.** 발송 조건은
   `status == "배송중" AND 송장 완비` + 수신 4조건이고, **두 조건 중 나중에 충족되는 쪽에서** 보낸다.
   관리자가 송장을 먼저 넣는 순서와 배송중을 먼저 올리는 순서를 둘 다 쓰기 때문에 한쪽에만
   훅을 달면 절반이 미발송된다. 공용 헬퍼 1개(`domains/orders/service.py` 안, `_notify_shipping_started`)를
   두고 두 곳에서 부른다:
   - `admin_update_status`(`domains/orders/service.py:1026`) — `await session.commit()`(`:1066`) 직후,
     `not is_rollback and new_status == "배송중"`이고 **송장 완비**일 때.
   - `admin_update_tracking`(`domains/orders/service.py:1070`) — 커밋 직후, `order.status == "배송중"`이고
     이번 호출에서 **송장 완비가 false→true로 바뀌었을 때**. 뮤테이션 전(`:1096` `now =` 직전)에
     `before = 완비(order)`를 잡아두고 커밋 뒤 `after = 완비(order)`와 비교한다.
   - **송장 완비 = 택배사 AND 송장번호 둘 다 비어 있지 않음.** 초안은 `shipped_at` None→값을 게이트로
     썼는데 두 가지가 어긋난다. (a) `shipped_at`은 송장번호만으로 찍힌다(`:1102`) — 관리자가 택배사를
     비우고 송장만 넣으면 `#{택배사}`가 빈 값으로 나가고, **알림톡은 변수가 비면 템플릿 불일치로
     실패해 SMS 대체로 떨어진다**(카카오 템플릿 검수 가이드 — 변수 치환 후 본문이 템플릿과 일치해야
     함). (b) 그 뒤 택배사를 채워도 `shipped_at`은 이미 값이라 재발화하지 않는다 → 영구 미발송.
     완비 전이를 게이트로 쓰면 둘 다 사라지고, admin 폼은 두 필드를 항상 함께 보내므로
     (`apps/admin/src/pages/orders/detail.tsx:506-507`) 정상 입력은 1회 호출에 완비된다.

   나머지 규칙:
   - **1회성**: 배송중 진입은 주문당 1회다(`ROLLBACK_FORBIDDEN_CURRENT`에 배송중이 있어
     되돌릴 수 없고 FORWARD는 배송완료로만 나간다 — `status_machine.py:51`). 송장 쪽은 완비의
     false→true 전이가 게이트다. 두 경로가 같은 주문에서 함께 발화하지 않는다: 상태 훅은 송장이 이미
     완비일 때만, 송장 훅은 상태가 이미 배송중일 때만 보낸다. 완비 상태에서의 송장 수정(택배사·번호
     교체)은 true→true라 재발송하지 않는다. **예외 하나**: 송장을 지웠다가 다시 넣으면 false→true를
     다시 지나 재발송된다 — 송장이 바뀐 재발송이라 그대로 둔다. 발송 이력 테이블은 만들지 않는다.
   - **수선은 회사 발송 송장을 쓴다**: repair는 `company_courier_company`/`company_tracking_number`
     (회사→고객, `db/src/db/models/commerce.py:203-204`), 나머지 3종은
     `courier_company`/`tracking_number`. repair의 `tracking_number`는 **고객이 회사로
     보낸** 송장이라 이걸 보내면 엉뚱한 번호가 간다. 자동 구매확정이 같은 기준으로 갈라진다
     (`docs/api-spec/money.md §8` 122행, `batch/router.py:49`). 완비 판정도 같은 필드 쌍으로 한다.
     고객→회사 구간(`발송대기`·`발송중`·`발송확인중`)은 애초에 알림 대상이 아니다 — 훅이 `배송중`
     하나에만 걸려 있어 그 상태들은 지나가지 않는다. 즉 알림은 **회사→고객 발송에만** 나간다.
   - **처리유형 매핑**: sale `주문`, custom `주문 제작`, sample `샘플 제작`, repair `수선`.
     본문의 "접수하신 ○○ 상품의 배송이 시작되었습니다"에 그대로 들어간다. token은 배송중 전이가
     없어 대상이 아니다.
   - **택배사 값은 저장값 그대로** 보낸다(공백 trim은 `:1098`이 이미 한다). 버튼이 DS면 카카오 인식
     명칭과 달라도 메시지는 가고 버튼만 빠진다 — 실 발송 후 버튼이 안 뜨면 상향 신호로 처리한다.
   - **주입·오류 처리**: `solapi`/`settings`/`background`는 `domains/payments/service.py:572`
     `_notify_payment_done`과 같은 keyword 기본값 `None` 방식으로 받고, `domains/orders/router.py:357`
     `admin_update_order_status`와 `:367` `admin_update_order_tracking`에 `Request`·`BackgroundTasks`를
     추가해 넘긴다(`domains/claims/router.py:80-90`이 같은 형태). `admin_update_status`의 호출자는
     이 라우터 1곳뿐이다(claims·quotes의 동명 함수는 별도 서비스, 2026-09-09 grep). best-effort —
     예외·실패는 로그만 남기고 상태 변경·송장 저장 결과에 영향을 주지 않는다.
   - **커밋 뒤에 보내는 이유**: 커밋 전이면 최대 10초짜리 solapi 호출이 `FOR UPDATE`로 잠긴 주문 row를
     붙잡는다(결제완료 알림을 커밋 뒤로 둔 것과 같은 이유). 커밋 뒤 `order` 속성 접근은 안전하다 —
     세션이 `expire_on_commit=False`(`api/main.py:182`).
   - fallback 문구(알림톡 실패 시 `disableSms:false`로 SMS 대체되는 본문):
     `[ESSE SION] 접수하신 {처리유형} 상품의 배송이 시작되었습니다.\n주문번호 {주문번호}\n{택배사} {송장번호}\nhttps://essesion.shop/my-page/orders`
     — 알림톡 본문과 같은 문장을 쓰고 링크는 실제 라우트(`app/router/index.tsx:174`)다. 이 길이는
     90바이트를 넘어 Solapi가 **LMS로 자동 전환**해 과금한다(SMS 한글 45자 한도). 대체발송은 알림톡
     실패 시에만 나가므로 감수한다. 확정 문구는 항목 8의 명세에도 적는다.

8. **환경·명세.** `infra/production.tfvars`의 `api_extra_env`에
   `SOLAPI_TEMPLATE_SHIPPING_STARTED = "KA01TP260902084020286DuSAS1joyKs"` 1줄. **이 파일은 gitignore라
   커밋되지 않는다** — `infra/production.tfvars.example:26` 아래에 같은 키를 주석으로 남겨 배포자가
   자기 로컬 tfvars에 넣도록 한다. 명세는 두 곳: `docs/api-spec/money.md §8`(132행 근처 주문
   상태기계)에 "배송중 AND 송장 완비 시 알림톡 1회(수신 4조건, 롤백 제외, repair는 company_* 송장)"
   한 줄, `docs/api-spec/domains.md §1`(19행 Solapi 공통)에 신규 템플릿 1종과 fallback 문구.

## 검증

- **pytest** — `apps/api/tests/test_admin_orders.py`에 5건: (1) 송장 완비 후 배송중 전이 → 1회 발송,
  (2) 배송중 후 송장 완비 → 1회 발송, (3) 송장번호만 넣고 배송중 → 미발송, 이후 택배사 추가 → 발송
  (초안 게이트라면 영구 미발송이던 경로), (4) 수신 조건 미충족 미발송, (5) 롤백·타 상태·repair의
  고객 송장만 있는 경우 미발송. 어서션은 `test_payments.py:1384`의 `_alimtalk_sent`(DryRun `sent`
  리스트에서 template_id 필터) 패턴 그대로. 변수 4개가 전부 비어 있지 않은지도 어서션에 넣는다.
  ```bash
  uv run pytest apps/api/tests/test_admin_orders.py apps/api/tests/test_config.py
  ```
- **로컬 실측** — api(:8000)에서 DryRun Solapi로 sale 주문을 진행중→배송중으로 올리고 api 로그의
  `DRYRUN alimtalk` 한 줄과 변수 내용을 확인한다.
- **브라우저** — store(:3000)에서 Aside(`.claude/skills/aside-browser/SKILL.md`)로 4가지:
  (1) 미인증 계정으로 주문서 진입 시 배송지 아래 Callout 노출, (2) **Callout을 무시하고 결제 버튼이
  그대로 동작**, (3) 결제완료 화면에 Callout 노출, (4) Callout에서 인증 완료 후 두 화면 모두 미노출
  + 마이페이지 알림 스위치가 켜져 있음(항목 2). (2)가 회귀 지점이다 — 유도가 결제를 막으면 안 된다.
- **vitest** — 기존 `payment-success.test.tsx`에 미인증/인증 각 1건으로 Callout 노출 조건.
- **린트·게이트** — `pnpm lint`, `uv run ruff check .`, `uv run pyright`,
  그리고 문서를 고치므로 `pnpm architecture:check`.
- **실 발송(배포 후)** — production에서 실제 번호로 배송중 1건 수신 확인. 세 가지를 본다: 변수 4개 치환,
  버튼이 뜨고 동작하는지(DS면 택배사 인식), 알림톡으로 왔는지 SMS 대체로 왔는지(대체면 템플릿
  불일치 의심). 정보성/광고성 구분은 실 발송에서만 드러난다.

## 되돌리는 법 / 상향 신호

- **알림톡**: `SOLAPI_TEMPLATE_SHIPPING_STARTED`를 비우면 즉시 미발송으로 돌아간다(코드 롤백 불필요).
  이게 설정을 `required`에 넣지 않는 두 번째 이유다.
- **택배사 명칭**: 실 발송에서 DS 버튼이 빠지거나 "배송조회가 안 된다"는 문의가 오면
  `apps/admin/src/pages/orders/detail.tsx:595`의 택배사 입력을 카카오 지원 택배사 select로 바꾼다.
  free-text가 원인이라는 실측이 먼저다.
- **인증 유도**: 인라인 Callout은 저장 상태가 없어 되돌릴 게 없다(컴포넌트 제거). 상향 신호는 두 방향:
  (a) 주문서·결제완료 노출 후에도 인증률이 오르지 않으면 로그인 직후 소프트 프롬프트를 **비모달
  배너**로 추가한다(기각한 대안 1 재론). (b) "왜 계속 보이느냐"는 문의가 오면 `shared/lib/browser-storage.ts`
  `browserStorage()`로 닫기 상태를 기기별 저장한다 — 새 헬퍼는 만들지 않는다.

## 기각한 대안

- **로그인 직후 모달 + 결제 버튼 인터셉트 + 기기별 거절 카운터(초안)**: 앱 진입 시 묻는 모달은
  맥락 없는 요청이라 허용률이 낮고, 결제 버튼 인터셉트는 비차단이어도 결제 직전에 단계를 하나
  끼운다. 인라인 두 곳이면 카운터·sessionStorage 신호·전역 게이트(`app-layout.tsx` 마운트,
  `auth/callback.tsx` 신호)가 전부 필요 없다. 재론 조건: 인라인만으로 인증률이 안 오를 때 — 그때도
  모달이 아니라 배너로.
- **거절 이력을 서버 컬럼으로**: 인라인 구조에선 거절이라는 상태 자체가 없다. 카운터가 부활하면 재론.
- **동의할 때까지 매 주문 반복 모달**: 거절한 사용자를 계속 붙잡는다.
- **`created_at`으로 "가입 직후"를 판정**: 시계·시차에 의존한다. 노출 지점을 주문 맥락으로 옮겨 판정
  자체가 사라졌다.
- **`shipped_at` None→값을 송장 훅 게이트로(초안)**: 택배사 없는 송장을 발송 조건으로 통과시키고,
  택배사를 뒤에 채우면 영구 미발송된다(항목 7). 완비 전이 게이트가 같은 비용으로 둘 다 막는다.
- **발송 이력 테이블(`claim_notification_logs` 방식)**: 배송중 재진입이 불가능하고 송장 쪽은
  완비 false→true가 게이트라, 남는 중복 경로는 "송장을 지웠다 다시 넣기" 하나뿐이고 그건
  재발송이 맞다. 재진입 가능한 상태(배송완료 등)로 알림을 넓히면 재론.
- **fallback을 45자 이내로 줄여 SMS 유지**: 송장번호·주문번호만으로 45자를 넘기 쉽고, 대체발송은
  실패 경로에서만 나간다. 과금이 문제로 관측되면 재론.

## 실패 모드

카카오 승인본의 버튼 유형·PFID를 확인하지 않고 기억으로 적어 배포하는 것, 그리고 빈 변수(택배사 없는
송장)를 발송 조건으로 통과시키는 것. 둘 다 발송은 조용히 SMS 대체로만 나가고, 그 사실은 실 발송
결과를 볼 때까지 드러나지 않는다.

## 참고 출처 (2026-09-09 조회)

- Solapi 알림톡 API — `kakaoOptions.{pfId,templateId,variables,buttons,disableSms}`, 변수 키
  `#{변수명}` 형식, `disableSms` 기본 false: https://solapi.com/developers/api/messages-ata
- 카카오 알림톡 버튼 유형(WL 변수 URL은 프로토콜 고정 + 경로 변수): https://devtalk.kakao.com/t/topic/135761 ,
  https://bizppurio.gitbook.io/guide/kakao/alimtalk/template_add
- 배송조회(DS) 버튼 — 본문 택배사명·송장번호 파싱, 지원 택배사 한정:
  https://support.cafe24.com/hc/ko/articles/13220398300569 , https://www.codemshop.com/manual/ufaqs/
- 알림톡 정보성/광고성 구분(배송 현황은 정보성): https://kakaobusiness.gitbook.io/main/ad/infotalk
- 대체발송 90바이트 초과 시 LMS: https://www.codeventer.com/kakao-alimtalk-vs-sms-comparison/
- 권한 요청 타이밍(맥락 있을 때, 지연 요청 허용률 ↑): https://web.dev/articles/permissions-best-practices ,
  https://www.appcues.com/blog/mobile-permission-priming
- 커머스 체크아웃 인라인 옵트인 + "주문 업데이트" 가치 제안: https://www.rejoiner.com/resources/sms-opt-in ,
  https://help.salesmessage.com/en/articles/8289096-sms-opt-in-guide-ecommerce-checkout
