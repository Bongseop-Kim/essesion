# 스토어 상품 카드 통일: 주문 상품 요약 — 실행 기록 (2026-11-19)

플랜 문서 없이 대화로 정해 바로 실행했다. 장바구니·주문서·주문 상세·클레임 상세의 상품 카드가 각자 구현돼
썸네일 유무·금액 위치·금액 표기(`₩`/`원`)·할인 표시가 서로 달랐다. 주문 상세는 썸네일이 없고 금액이 오른쪽 열에
있었으며 할인 전 금액만 보였다.

## 한 일

- **공통 요약** `apps/store/src/entities/order-item/ui/order-item-summary.tsx` — 썸네일 6rem + 배지 + 이름 +
  옵션 줄 + 금액(설명 아래, `nowrap`, 할인 시 원가 취소선·할인가·쿠폰 이름). 카드 테두리와 아래 액션은 호출자가
  감싼다. 장바구니의 `ItemPriceDisplay`, 주문서의 `OrderItemPrice`를 대체했다.
- **주문된 상품 요약** `apps/store/src/features/orders/ui/ordered-item-summary.tsx` — `OrderItemOut`을 위
  요약으로 옮긴다. 주문 상세·클레임 상세가 같이 쓴다.
  - 썸네일: 판매 상품은 `item_data.product.image` 스냅샷, 수선은 넥타이 사진(서명 URL), 맞춤·샘플은 첫 참고 이미지.
  - 금액: `unit_price × quantity`에서 `line_discount_amount`(줄 전체 할인, api `orders/service.py` 확인)를 뺀다.
- **수선 요약 문구** `features/reform/model/reform.ts`의 `reformServiceParts` — 라벨을 빼고 값만:
  `자동 지퍼 · 키 177cm · 딤플 · 폭 8cm · 복원`. 키/길이는 구분이 필요해 한 글자를 남겼다. 복원 메모는 길 수
  있어 요약에서 뺐다. 수선 신청 폼의 옵션 요약도 같은 문구를 쓴다.
- **화면별**
  - 장바구니: 금액 표기를 `원`으로(합계·주문하기 버튼 포함). 상품 이미지에 `resizedImage(…, 600)` 적용.
  - 주문서: 쿠폰 이름은 금액 아래로, 아래 줄은 '쿠폰 변경' 버튼만.
  - 주문 상세: 수선은 라벨 행·큰 사진 그리드를 없애고 복원 메모만 '요청사항'으로 남긴다. 맞춤·샘플은 '주문 내용' 행 유지.
  - 클레임 상세 '대상 상품': `ListItem` 대신 카드 + `신청 수량 N개 · 주문 번호`.
- 어드민 주문 상세와 공용 `packages/shared/src/order-content.ts`(라벨 행)는 건드리지 않았다 — 작업자는 항목별 확인이 필요하다.
- 주문·클레임 **목록** 화면은 텍스트 한 줄을 유지했다.

## 검증

- store vitest 218개 통과, store typecheck, `pnpm lint`(check-harness 포함), `pnpm architecture:check` 통과.
- `order/detail.test.tsx`의 수선 케이스를 새 요약 문구로, `reform.test.ts`의 라벨 기대값을 갱신했다.

## 확인하지 않은 것

- 실제 화면(모바일 폭 포함)은 띄워 보지 않았다. 수선 옵션이 많으면 요약 줄이 두 줄로 바뀐다(말줄임 없음).
- 장바구니·주문서에서는 복원 메모가 더 이상 보이지 않는다(주문 상세 '요청사항'에서만 보임).
- 클레임 상세의 맞춤·샘플 상품은 참고 이미지를 불러오지 않아 기본 실루엣이 나온다.
- 상품 목록·상세·쿠폰 모달의 `₩` 표기는 범위 밖이라 그대로다.
