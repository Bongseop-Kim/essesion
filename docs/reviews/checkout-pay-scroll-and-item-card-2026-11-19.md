# 주문서: 결제 버튼 스크롤과 상품 카드 재배치 — 실행 기록 (2026-11-19)

플랜 `docs/plans/checkout-pay-scroll-and-item-card.md`(삭제)를 실행했다. (A) 결제 수단이 하단 바에 가려 있으면
"결제하기"의 첫 클릭은 결제 수단으로 스크롤만 한다. (B) 주문 상품 카드에서 금액 줄바꿈이 깨지던 배치를 고쳤다.

## 한 일

- **A** `apps/store/src/features/checkout/ui/checkout-shell.tsx` — 누른 시점에 위젯 영역의 바닥과 actionBar의
  윗변을 비교한다. 가려 있으면 `scrollIntoView`와 `focus({ preventScroll: true })`만 하고 latch(`paymentSeen`)를
  켠다. latch는 다시 끄지 않는다. 버튼 문구는 그대로다. 테스트 3개(`checkout-shell.test.tsx`)를 추가했다.
- **B** `apps/store/src/pages/order/order-form.tsx` — 이미지 6rem, 금액을 설명 아래 왼쪽으로, 쿠폰 행은 Grid
  밖 카드 전체 폭. 금액 `Text`는 `white-space: nowrap`, 할인 시 원가·할인가를 `HStack wrap`으로 나란히 둔다.

## 검증

- `pnpm lint`, 스토어 typecheck·test 통과.
- 로컬 스토어의 장바구니 주문서에서 토스 테스트 위젯으로 확인했다.
  1. 390×844 첫 화면에서 누르면 결제 수단이 헤더 바로 아래로 스크롤되고 포커스가 옮겨지며 결제창은 뜨지 않는다.
  2. 맨 위로 돌아와 다시 누르면 스크롤 없이 결제가 시작된다(latch).
  3. 375×667에서는 스크롤 뒤에도 위젯 바닥(670)이 바(603)에 가리지만 두 번째 클릭은 결제를 시작한다.
  4. 직접 스크롤해 결제 수단이 바 위로 다 보이면 첫 클릭에 결제가 시작된다.
  5. 1280폭 데스크톱에서는 첫 클릭에 결제가 시작된다(위젯 바닥 948 ≤ 바 윗변 964).
  6. 상품 카드에서 금액이 한 줄로 보이고, 쿠폰 적용 시 "~~38,000원~~ 33,000원"이 한 줄에 나란히 보인다.

## 확인하지 않은 것

- `e2e/store-money-path.spec.ts`는 로컬에서 돌리지 않았다. CI가 돌린다. 5번이 같은 가정을 확인한다.
- 주문 제작·샘플 결제(`order-payment-page.tsx`). 같은 `CheckoutShell`을 쓴다.
- 수선 항목 카드와 실기기. 상품 항목과 DevTools 수준의 뷰포트 에뮬레이션으로만 봤다.
