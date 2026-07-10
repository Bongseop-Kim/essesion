# store 체크아웃(C3) 재구현 플랜

> YeongSeon 장바구니 결제 경로(`pages/order/order-form.tsx` — BaseCheckoutPage 미사용 "경로 A")를 essesion store로 재작성.
> 서버 계약의 권위는 `docs/api-spec/money.md` — **Toss orderId = `payment_group_id`**, 웹훅 없이 successUrl 콜백 → `POST /payments/confirm`, 금액은 서버 재계산이 소스(클라 amount는 사전 일치 검증만).
> 백엔드·api-client는 전부 준비 완료(§4) — 이 청크는 **프론트 + 승인된 백엔드 변경 1건(D8: stale 취소 배치 쿠폰 복원)**.

## 1. 범위

- **라우트 3개 신설** (`app/router/index.tsx`, lazy, 전부 ProtectedRoute): `/order/order-form`, `/order/payment/success`, `/order/payment/fail`.
- **store-local composite 신설** (규칙 "2개 앱 이상만 shared" — packages/shared 아님): SummaryCard, PaymentActionBar, ShippingAddressCard(+선택 모달), CouponSelectModal(cart에서 추출), Toss PaymentWidget 래퍼 + 결제 훅. **C4~C7 재사용 계약이 이 청크의 산출물**(§6).
- **진입 계약**: `/cart` "주문하기" → `navigate("/order/order-form", { state: { cartItemIds } })` (C2에 이미 구현됨, `pages/cart/index.tsx:204-214`). C1 "구매하기"는 담기 후 `/cart` 이동이므로 진입점은 cart 하나뿐.
- **제외 (이연)**: BaseCheckoutPage식 공용 페이지 골격(D7 — C5에서 추출), 결제 전 알림수신동의 플로우(D5 — C8), success의 repair/token 분기 확장(C4/C7 — switch 자리만), 주문 내역 페이지(C9 — 성공 화면 CTA는 임시), Playwright 스모크(체크리스트 별도 항목).

## 2. 결제 시퀀스 (확정 계약)

```text
/cart ─주문하기─▶ /order/order-form (state.cartItemIds)
  │ state 없음/항목 0개 → /cart 복귀
  ├─ cart 모델에서 items 재조립(항목별 쿠폰 포함) + 배송지(기본 자동선택) + 금액 미리보기
  └─ [결제하기]
       1. 검증: 배송지·항목·위젯 ready
       2. POST /orders {shipping_address_id, items[]} → {payment_group_id, total_amount, orders[]}
          (서버: 재고 물리 차감 + 쿠폰 active→reserved. 멱등키 없음 — 재호출 = 중복 주문)
       3. total_amount ≠ 클라 합계 → 중단 + 스낵바(주문은 30분 stale 배치가 취소)
       4. sessionStorage "checkout:pending" = {cartItemIds} 저장
       5. widgets.requestPayment({orderId: payment_group_id, orderName, successUrl, failUrl})
            ├─ 사용자 결제창 닫음 → promise reject(USER_CANCEL) → 무시, 주문서 잔류(D6 재사용)
            ├─ 실패 → failUrl 리다이렉트
            ▼ 성공
/order/payment/success?paymentKey&orderId&amount   ← 전체 페이지 리다이렉트(라우터 state 소실)
  ├─ 파라미터 가드 + 1회 실행 가드
  ├─ POST /payments/confirm {payment_key, payment_group_id: orderId, amount}
  │    (서버: lock → Toss 승인(로컬 DryRun 항상 성공) → 확정. 실패 시 unlock=쿠폰 복원.
  │     멱등: 결제후 상태·ALREADY_PROCESSED 조회 복구 → 재시도/재방문 안전)
  ├─ 성공: 스냅샷의 cartItemIds를 cart에서 제거 → 스냅샷 삭제 → 완료 화면(응답 order_number 표시)
  └─ 실패: 에러 화면 + [다시 확인](confirm 재호출 — 멱등) + [주문서로 돌아가기]
/order/payment/fail?code&message → 안내 + 에러코드 표시 + [주문서로 돌아가기]
```

- `orderName`(Toss 필수): 1건 = 상품명, N건 = `"{첫 상품명} 외 N-1건"`.
- `customerKey` = `useSession().user.id`(UUID).
- confirm 성공 화면 데이터는 응답만으로 충분 — `ConfirmedOrder{order_id, order_number, order_type, status}` (`payments/schemas.py:12-18`). 스냅샷은 cart 정리용 `cartItemIds`만.
- C3의 cart엔 product만 있으므로 주문은 sale 1건 그룹이지만, **계약상 그룹은 복수 주문 가능**(sale+repair 분리, `orders/service.py:272-341`) — 완료 화면은 `orders[]`를 목록으로 렌더.

## 3. 원본 대비 의도적 차이 (기능 명세는 보존)

| YeongSeon | essesion | 근거 |
|---|---|---|
| 주문 상품을 zustand persist(`order-storage`)로 전달 | **router state `cartItemIds` + cart 모델 재조회.** 새로고침 시 state 소실 → /cart 복귀 | persist store 하나 제거. cart 모델(C2)이 이미 진실 소스 |
| 배송지 선택 = **팝업 창 + postMessage** | **ResponsiveModal**(목록 선택 + 신규 입력 폼) | 팝업 차단·창간 통신 제거. C8 배송지 관리가 이 feature 재사용 |
| 결제 전 알림수신동의 모달 플로우 | **이연(D5)** — notification-preferences는 C8 도메인 | 청크 경계. 명세는 이 표에 기록됨 |
| 결제하기 클릭마다 주문 재생성(경로 A) | **pendingOrder 스냅샷 캐시(D6)** — 경로 B(`use-checkout-payment.ts`)의 검증된 패턴을 A에 적용 | 재시도 시 중복 주문·재고 이중 차감·쿠폰 잠김(D8) 회피 |
| `window.__E2E_MOCK_TOSS__` E2E 목 | 생략 — Playwright 스모크는 Toss 샌드박스로(체크리스트) | YAGNI |
| success에서 token/repair/sample 분기 | `order_type` switch 자리만, C3는 기본(완료 화면)만 | cart엔 product만. C4/C7이 케이스 추가 |

보존: 선주문 생성 → Toss → confirm 순서, 항목별 쿠폰, 서버 금액 단일 소스 검증(불일치 시 중단 — 경로 A 동작), 기본 배송지 자동 선택, USER_CANCEL 무시, fail의 code/message 표시.

## 4. 데이터 계약 (전부 생성 완료 — codegen 불필요)

| 엔드포인트 | api-client (`/query`) | 용도 |
|---|---|---|
| POST /orders | `createOrderMutation` | 결제하기 1단계. body `OrderCreateRequest{shipping_address_id, items: OrderItemIn[]}` → `{payment_group_id, total_amount, orders[]}` |
| POST /payments/confirm | `confirmPaymentMutation` | success 콜백. body `{payment_key, payment_group_id, amount}` |
| GET /users/me/addresses | `listAddressesOptions` | 배송지 목록(기본 우선 정렬) |
| PUT /users/me/addresses | `upsertAddressMutation` | 신규 배송지(첫 구매자 필수 경로) |
| GET /coupons/mine | `listMyCouponsOptions` | 쿠폰 선택 모달(`active_only`) |
| GET /orders/{id} | `getOrderOptions` | (C3 미사용 — C9) |

- `/orders/{id}/confirm-purchase`는 **배송 후 구매확정**이며 결제 confirm이 아님 — C3 미사용(C9 소관).
- cart item → `OrderItemIn` 매핑: cart 모델 input이 이미 `{item_id, product_id, selected_option_id, quantity, applied_user_coupon_id}` 보유(`features/cart/model/items.ts:22`) → `item_type: "product"`, `reform_data: null`만 보강.
- 클라 금액 미리보기 = cart의 `couponDiscount`/합계 로직 재사용. sale 배송비 0 고정(money.md §2 — 무료배송 임계 없음).

## 5. Toss 위젯 연동 (제안)

- **SDK**: `@tosspayments/tosspayments-sdk`(신 위젯 SDK, YeongSeon과 동일 — 검증된 계약). `pnpm-workspace.yaml` catalog + store dependency 추가. 스크립트는 런타임 로드라 번들 영향 미미, 페이지 자체도 lazy 라우트.
- **clientKey**: `VITE_TOSS_CLIENT_KEY` env 신설(`.env.example`에 Toss 문서 공개 테스트 키 주석 안내). 클라이언트 키는 공개키라 노출 무방 — 백엔드 전달 엔드포인트 불필요(현재 백엔드에 clientKey 관련 코드 없음 확인).
- **래퍼 계약** (`features/checkout/ui/payment-widget.tsx`): props `{amount, customerKey}`, ref `{setAmount(amount), requestPayment({orderId, orderName, successUrl, failUrl})}`. 내부: `loadTossPayments(key)` → `widgets({customerKey})` → `setAmount({currency:"KRW", value})` → `renderPaymentMethods` + `renderAgreement(variantKey:"AGREEMENT")`. 쿠폰 변경 등 amount prop 변경 시 `setAmount` 동기화. 로딩 중 `Skeleton`, 초기화 실패 시 `ContentPlaceholder`.
- **로컬 검증 경로**: 테스트 clientKey로 위젯·결제창은 실동작 → success 리다이렉트의 실제 paymentKey를 서버 DryRun(`toss.py:75-95`, 시크릿 없으면 항상 승인 성공)이 받아 전 구간 왕복 가능.

## 6. Composite 경계 (store-local 배치 + C4~C7 재사용 계약)

```text
apps/store/src/
├─ shared/ui/
│  ├─ summary-card.tsx        # compound: Root/Section/Row/Total — 프리젠테이션 전용, 도메인 로직 0
│  └─ payment-action-bar.tsx  # {amount, onClick, disabled?, loading?, helperText?} → "N원 결제하기"
├─ features/checkout/
│  ├─ ui/payment-widget.tsx   # §5 Toss 래퍼
│  └─ model/use-checkout-payment.ts
│     # 파라미터화 지점(경로 B 패턴): {createOrder: () => Promise<{paymentGroupId, totalAmount, ...}>,
│     #  orderName, expectedAmount?, snapshotKey} — 주문 생성 함수를 콜러가 주입.
│     # 훅이 공통 처리: pendingOrder 스냅샷 캐시(D6)·금액 검증·requestPayment·USER_CANCEL·중복 클릭 가드.
│     # C5(custom)·C6(sample)·C7(token)은 createOrder만 갈아끼움 — 이게 재사용 계약의 핵심.
├─ features/shipping/
│  ├─ ui/shipping-address-card.tsx    # {address|null, onChange?} 표시 카드
│  ├─ ui/address-select-modal.tsx     # ResponsiveModal: 목록(SelectBox) + 신규 폼(upsertAddress)
│  └─ model/use-daum-postcode.ts      # 우편번호 검색(스크립트 동적 로드) — C8 재사용
├─ features/coupon/
│  ├─ ui/coupon-select-modal.tsx      # pages/cart/index.tsx(793-847) 인라인 모달을 추출 — cart도 교체
│  └─ model/discount.ts               # couponLabel/couponDiscount를 features/cart/model/items.ts에서 이동
└─ pages/order/
   ├─ order-form.tsx
   ├─ payment-success.tsx
   └─ payment-fail.tsx
```

- SummaryCard/PaymentActionBar는 페이지 비의존 프리젠테이션이라 `shared/ui`(app-local, content-layout 전례), 도메인 로직이 있는 것만 features.
- **BaseCheckoutPage(페이지 골격 공용화)는 지금 만들지 않는다(D7)** — 소비자가 order-form 하나뿐. C5가 두 번째 소비자가 될 때 추출. 대신 위 조각들이 전부 props-only라 추출 비용은 조립 코드뿐.

## 7. UI 하네스 매핑

ContentLayout(sidebar+actionBar의 핵심 소비자 — cart와 동일 패턴):

| 슬롯/섹션 | 구성 |
|---|---|
| breadcrumbs | 홈 / 장바구니 / 주문서 |
| 본문 | ShippingAddressCard(`Box` 카드 + "변경" `ActionButton` ghost) → 주문 상품 카드 목록(`Box`+`ImageFrame`+`Text`, 항목별 "쿠폰 변경" 버튼 — cart 항목 카드 패턴 재사용) |
| sidebar | SummaryCard(상품금액/쿠폰할인/배송비 `Row` + `Total`, cart `SummaryRow` 패턴) + PaymentWidget(결제수단+약관) |
| actionBar | PaymentActionBar(`ActionButton` brandSolid — 화면당 1개 CTA 규칙, 배송지 없으면 helperText) |

- 모달류는 전부 shared `ResponsiveModal`(모바일 BottomSheet↔PC Modal), 확인성 대화상자는 `AlertDialog`, 결과 알림 `snackbar()`.
- success/fail 페이지: ContentLayout(슬롯 없음) + `ResultSection`/`ContentPlaceholder` + `ActionButton`. 처리 중 `ProgressCircle` + "결제 확인 중입니다".
- 접근성: 위젯 로딩 영역 `aria-busy`, 에러 화면 제목은 `Text as="h1"`, 금액 변동 스낵바로 공지. 임의 색/px 금지 — `pnpm lint`(check-harness)가 강제.

## 8. 성공/실패 대사(reconciliation) 흐름

- **success 재방문/새로고침 안전**: confirm은 서버 멱등(결제후 상태 사전체크 200 DONE, `ALREADY_PROCESSED` 조회 복구 — money.md §9). 클라는 1회 실행 가드만.
- **confirm 실패**: unlock으로 쿠폰 자동 복원(`payments/service.py:292-312`) → "다시 확인"(재호출)과 "주문서로 돌아가기" 제공. 주문서 복귀 시 새 주문 생성 흐름 정상.
- **결제창 이탈(USER_CANCEL)**: reject 무시, 주문서 잔류. pendingOrder 캐시(D6)로 같은 스냅샷 재시도는 **주문 재생성 없이** 같은 `payment_group_id`로 재요청.
- **이탈 주문 정리**: 대기중 30분 초과 → 서버 배치 자동 취소(`batch/router.py:62-76`). 재고는 복원 안 됨(원 동작 보존).
- **쿠폰 잠김 해소(D8, 확정)**: 쿠폰 복원(reserved→active)이 confirm의 Toss 승인 실패 경로에만 있고 **stale 취소 배치에는 없어**, 이탈 후 스냅샷을 바꿔 재주문하면(배송지만 변경 등) 같은 쿠폰이 reserved라 주문 생성 실패 — 수동 복구 전까지 잠김(원본도 동일한 스펙 수준 구멍). D6이 흔한 케이스(그대로 재시도)를 막고, **배치에 쿠폰 복원을 추가해 근본 해소한다**(§9 D8, §10-7).
- cart 정리는 confirm 성공 후에만(스냅샷 경유) — 실패·이탈 시 장바구니 보존.

## 9. 결정 사항 (구현 전 확정)

| ID | 결정 | 권장 |
|---|---|---|
| D1 | Toss SDK = `@tosspayments/tosspayments-sdk`(신 위젯). catalog 추가 | 확정 권장 |
| D2 | clientKey = `VITE_TOSS_CLIENT_KEY` env(공개키). 백엔드 경유 없음 | 확정 권장 |
| D3 | 배송지 선택 = ResponsiveModal(원본 팝업+postMessage 대체) + 신규 입력 폼(첫 구매자 필수) + Daum 우편번호 | 확정 권장 |
| D4 | 주문서 진입 = router state `cartItemIds`(persist store 없음). 새로고침 → /cart | 확정 권장 |
| D5 | 알림수신동의 플로우는 C8로 이연 | 권장 |
| D6 | pendingOrder 스냅샷 캐시(items+배송지+쿠폰 동일하면 주문 재사용) — 경로 B 패턴 | 확정 권장 |
| D7 | 공용 결제 페이지 골격은 C5에서 추출(지금은 order-form 직조립) | 권장 |
| **D8** | **백엔드 변경(money 경로 — 승인됨)**: stale 취소 배치에 쿠폰 `reserved→active` 복원 추가 + money.md §9 의도적 차이 목록에 기록 + testcontainers 테스트. C3 프론트와 독립 커밋 | **확정** |
| D9 | 성공 화면 CTA = 주문번호 표시 + "쇼핑 계속하기"(/shop). "주문 내역" 링크는 C9에서 추가 | 권장 |

## 10. 작업 순서

1. **의존성·env**: catalog에 `@tosspayments/tosspayments-sdk` + store dependency, `.env.example`에 `VITE_TOSS_CLIENT_KEY`.
2. **추출 리팩터**: cart 쿠폰 모달 → `features/coupon`(cart 교체), `couponLabel/couponDiscount` → `features/coupon/model/discount.ts`.
3. **프리젠테이션**: `shared/ui/summary-card.tsx`, `shared/ui/payment-action-bar.tsx`.
4. **features/shipping**: 카드 + 선택/신규 모달 + Daum 우편번호 훅.
5. **features/checkout**: PaymentWidget 래퍼 → `use-checkout-payment`(D6 포함).
6. **pages/order 3종** + 라우터 등록(ProtectedRoute) — order-form 조립, success(confirm+cart 정리), fail.
7. **D8 백엔드(확정)**: `batch/router.py` `cancel_stale_orders`에서 취소 주문의 쿠폰을 `reserved→active` 복원 — `payments/service.py`의 `_group_coupon_ids`(주문 id들 → reserved 쿠폰 id) 패턴 재사용(공용 헬퍼로 승격), 복원은 해당 주문 소유자 기준. testcontainers 테스트(대기중 30분 초과 + reserved 쿠폰 → 취소 후 active) + money.md §9에 의도적 차이로 기록. C3 프론트와 독립 커밋.
8. **검증**: `pnpm lint` → `pnpm turbo typecheck` → 실렌더: 로컬 API(docker compose → alembic → seed → uvicorn, Toss DryRun) + 테스트 clientKey로 **cart → 주문서 → 테스트 결제창 → success confirm → cart 비워짐** 왕복 1회, fail/USER_CANCEL/새로고침(→/cart)/success 재방문(멱등) 케이스 수동 확인. 반응형(모바일 하단 고정 actionBar) 확인.
