# 알림톡 템플릿 .com 이전 + 3종 추가 — 2026-11-12

`essesion.shop` 링크로 등록돼 있던 채널 템플릿 5종을 `essesion.com` 기준으로 새로 등록하고, 알림 3종을
추가했다. 솔라피에는 **등록만** 했고 검수 요청은 하지 않았다 — `essesion.com`이 아직 DNS에 없어 버튼 링크가
열리지 않는다.

## 솔라피 템플릿 (채널 영선산업, 전부 검수 전)

| 설정 키 | 이름 | 템플릿 ID | 변수 |
|---|---|---|---|
| `SOLAPI_TEMPLATE_PAYMENT_DONE` | [com] 결제 완료 | `KA01TP261112021153272NCXAG29KmBF` | `#{주문번호}` `#{결제금액}` |
| `SOLAPI_TEMPLATE_SHIPPING_STARTED` | [com] 배송 시작 | `KA01TP2611120211388286CghGaR5N1a` | `#{처리유형}` `#{주문번호}` `#{택배사}` `#{송장번호}` |
| `SOLAPI_TEMPLATE_CLAIM_DONE` | [com] 클레임 처리 완료 | `KA01TP261112021153180pqpPVgHAhgF` | `#{처리유형}` `#{주문번호}` |
| `SOLAPI_TEMPLATE_CLAIM_REJECTED` | [com] 클레임 거부 | `KA01TP261112021153221A7l2EiWojTz` | `#{처리유형}` `#{주문번호}` |
| `SOLAPI_TEMPLATE_QUOTE_RECEIVED` | [com] 견적 요청 접수 | `KA01TP261112021153668xudY8hPZTMK` | 없음 |
| `SOLAPI_TEMPLATE_QUOTE_SENT` (신규) | [com] 견적 도착 | `KA01TP261112022853721QBOBCFkmFwg` | `#{견적번호}` `#{견적금액}` |
| `SOLAPI_TEMPLATE_CLAIM_PICKUP` (신규) | [com] 클레임 수거 안내 | `KA01TP261112022853758mpDFVtxnzll` | `#{처리유형}` `#{주문번호}` |
| `SOLAPI_TEMPLATE_REPAIR_RECEIVED` (신규) | [com] 수선 상품 도착 | `KA01TP261112022853797gfaqavcIrGf` | `#{주문번호}` |

인증번호는 솔라피 기본 그룹 템플릿이라 도메인이 없어 그대로 둔다. 기존 .shop 템플릿 5종도 전환 전까지 유지.

## 바꾼 것

- **버튼 링크**: 기존 `/order/order-list`·`/order/claim-list`는 현 스토어 라우터에 없는 경로(`order/:orderId`에
  걸린다)였다. `/my-page/orders`·`/my-page/claims`·`/my-page/quote-request`로 교체.
- **형식 통일**: 값이 있는 템플릿은 헤더 + 아이템리스트형. 본문은 인사 + 한 문장 + 버튼 안내로 줄였다.
- **공통 배너**: 8종 모두 같은 이미지 1장(`#111` 배경 + 로고 글리프 + ESSE SION 워드마크, 800×400, 솔라피
  스토리지 `ST01FZ261112025404182WaG55DPceVa`). 발신 프로필이 `영선산업`이라 브랜드가 보이는 자리가 이미지뿐이다.
  원본은 Penpot `디자인` 파일의 `알림톡 배너 시안` 페이지.
- **문구**: "앱에서 확인"(앱 없음) → "아래 버튼에서 확인", 내부 용어 "클레임" → `#{처리유형}`(취소/반품/교환),
  "거부되었습니다" → "진행이 어려워 안내드립니다".
- **코드**
  - 클레임 알림 변수 `#{처리유형}`이 영문 type(`cancel` 등)을 그대로 보내던 것을 한글 라벨로, `#{주문번호}` 추가.
  - fallback 문구의 `https://essesion.shop` 하드코딩 3곳 → `settings.frontend_origin`.
  - 견적 도착(`admin/quotes.py`), 수거 안내(클레임 outbox에 `수거요청` 추가), 수선 상품 도착
    (`orders/service.py` `_notify_repair_received`) 훅. 주문 알림 2종은 `_send_order_alimtalk`로 공통화.
  - 명세: `domains.md §1·§4`, `money.md §8`.

## 남은 일 (순서대로)

1. `essesion.com` 개통 뒤 솔라피 콘솔에서 8종 검수 요청.
2. 승인되면 `production.tfvars` `api_extra_env`의 `SOLAPI_TEMPLATE_*`를 위 ID로 교체·추가하고 apply.
   **코드 배포와 ID 교체는 같은 시점에** — 클레임 완료/거부는 새 코드가 변수 2개를 보내는데 기존 .shop
   템플릿은 변수가 1개/0개다. 남는 변수를 솔라피가 무시하는지는 확인하지 않았다.
3. 실 발송 확인 뒤 기존 .shop 템플릿 5종 숨김.

## 검증

- `ruff check`·`ruff format --check`·`pyright apps/api` PASS.
- 테스트 추가: `test_claims.py`(한글 유형·origin 링크, 수거요청 발송/미설정 skipped),
  `test_admin_orders.py`(수선 상품 도착, custom 접수 미발송), `test_admin_quotes_inquiries.py`(견적 도착).
- `test_claims`·`test_admin_orders`·`test_admin_quotes_inquiries`·`test_quotes`·`test_admin_phase_d`·
  `test_payments`·`test_config`·`test_auth` 194 PASS.
- **미검증**: 카카오 검수 통과 여부, 배너가 실제 말풍선에서 보이는 모습(콘솔 미리보기는 자리표시만 보여준다), 수거 안내 문구("포장해 준비")가 실제 수거 운영 방식과 맞는지.
