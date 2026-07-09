# store 재작성 — 세션별 프롬프트

새 세션마다 **[공통 헤더]** + **[청크 N]** 를 이어붙여 프롬프트로 사용한다.
한 청크 = 한 세션 = PR 하나. 순서는 쇼핑 퍼널·의존성 순. 각 청크는 독립 렌더·검증 가능한 수직 슬라이스.

의존 순서: C1 shop → C2 cart → C3 결제 골격 → C4~C6 생성 플로우 → C7 토큰 → C8~C10 마이페이지 → C11 정적 → C12 design(별도 기획).
C11(정적)은 순서 무관, 아무 때나 가능.

---

## [공통 헤더] — 매 세션 맨 앞에 붙일 것

```
essesion 모노레포 store 앱 재작성 작업이다. 새 세션이므로 먼저 읽어라:
- AGENTS.md, ARCHITECTURE.md, docs/CHECKLIST.md(§5 프론트), packages/shared/AGENTS.md, apps/store/AGENTS.md
- 참고 레포(읽기 전용, 코드 복사 절대 금지): ../git/YeongSeon/apps/store — 기능 명세의 원본.

대원칙(위반 금지):
- 기존 코드 이식 금지, 전부 새로 작성. 기능 명세(무엇을 하는가)만 동일 재현. 착수 전 기능/성능/유지보수 개선점 있으면 먼저 제안.
- UI는 @essesion/shared 만(프리미티브+토큰, 하네스 우선순위 사다리). 앱 로컬 재구현·임의 값 우회 금지.
- 서버 통신은 @essesion/api-client 만. supabase-js 금지. 데이터는 /query 훅(TanStack Query 옵션 팩토리) 사용.
- 시크릿 커밋 금지.

이미 구축돼 있으나 문서엔 아직 없는 것:
- 레이아웃: @/shared/ui/content-layout 의 <ContentLayout> — 슬롯 breadcrumbs / sidebar / actionBar / detail.
  PC는 2fr:1fr, 우측 sticky 사이드바 + 사이드바 하단 액션바 / 모바일은 스택 + 하단 고정 액션바. (YeongSeon PageLayout 대응)
  design 페이지는 이 레이아웃을 쓰지 않는다.
- @essesion/shared 의 <Breadcrumb> (items + renderLink 패턴; Header.renderLink와 동일 계약).
- 데이터 패칭 패턴 예시: apps/store/src/features/home/popular-products.tsx
  → useQuery(listProductsOptions({ query: {...} })) 식. 훅은 @essesion/api-client/query 에서 import.
- 완료된 라우트: / (home), /login, /auth/callback. 그 외는 미구현.
- 앱 셸(Header/Footer/SnackbarHost)은 app/layout/app-layout.tsx 가 이미 소유. 페이지는 본문만.

배치·검증:
- FSD 배치(entities / features / widgets / pages) + app/router/index.tsx 에 lazy 라우트 등록.
- 완료 후 필수: pnpm lint (하네스 정적검사 포함) → pnpm turbo typecheck → 실제 렌더 확인(/run 또는 pnpm --filter store dev).
  필요 시 로컬 API: docker compose up -d → alembic upgrade → seed → uv run uvicorn api.main:app --reload (시크릿 없으면 Toss/GCS DryRun).
- 세 검증 통과 결과를 보고할 것.
```

---

## C1 — shop (상품 목록 + 상세)

```
[C1: shop] /shop(목록)·/shop/:id(상세) 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/features/shop/page.tsx, pages/shop/detail.tsx
데이터: /products(목록·정렬·필터·페이지네이션 — 지원 query 범위 확인), /products/{id}, /products/{id}/like(찜 토글).
  기존 entities/product 의 ProductCard/ProductCardSkeleton 재사용. 담기는 cart API(/cart).
UI:
- 목록 = ContentLayout(슬롯 없음) + 반응형 Grid + ProductCard. 정렬/검색은 shared(SegmentedControl/SelectBox/TextField).
- 상세 = ContentLayout(detail=상세설명/스펙, actionBar=담기·바로구매) + 이미지 갤러리(ImageFrame/AspectRatio) + 옵션 선택 + 찜 토글.
착수 전: YeongSeon shop 스펙 + 현재 entities/product 를 읽고 개선점(무한스크롤 vs 페이지네이션 등) 제안.
```

## C2 — cart (장바구니)

```
[C2: cart] /cart 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/widgets/cart-checkout/ui/CartCheckoutPage.tsx, features/cart/**
데이터: /cart(조회·수량변경), /cart/remove, /coupons/mine(항목별 쿠폰), 상품 재조회는 /products.
  비로그인 로컬 장바구니 ↔ 로그인 동기화 정책은 YeongSeon features/cart 훅의 동작을 스펙으로 재현(코드 복사 금지).
UI: ContentLayout(sidebar=금액 요약, actionBar=주문하기). 항목 카드/선택/삭제 툴바는 shared 조합.
착수 전: 장바구니 동기화·선택·쿠폰 적용 흐름을 정리해 제안.
```

## C3 — 결제 골격 (주문서 + Toss 결제 + 공용 결제 composite)

```
[C3: checkout] 장바구니 결제 경로 구현: /order/order-form → Toss 결제 → /order/payment/success · /fail.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/order/order-form.tsx,
  widgets/checkout/ui/BaseCheckoutPage.tsx, pages/payment/success.tsx, pages/payment/fail.tsx,
  shared/composite/{summary-card,payment-action-bar,payment-widget,payment-widget-aside,shipping-address-card}.tsx
데이터: /orders(생성), /orders/{id}, /orders/{id}/confirm-purchase, /users/me/addresses(배송지), /coupons/mine.
  Toss 결제위젯 SDK 연동(successUrl/failUrl 콜백 → confirm). 로컬은 Toss DryRun 고려.
신규(store-local composite, shared 아님 — 규칙 67): SummaryCard, PaymentActionBar, 배송지 카드, 쿠폰 선택,
  Toss PaymentWidget 래퍼. 이후 C4~C7이 재사용하므로 재사용 가능하게 설계.
UI: ContentLayout(sidebar=SummaryCard+결제수단, actionBar=결제하기). 이 청크가 sidebar+actionBar의 핵심 소비자.
착수 전: Toss 위젯 연동 방식·composite 경계(store-local 위치)·성공/실패 대사 흐름을 제안.
```

## C4 — reform (넥타이 수선·리폼)

```
[C4: reform] /reform 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/reform/index.tsx, features/reform/**
데이터: reform 단가 조회 + 이미지 업로드(GCS 서명 URL). 접수 결과는 장바구니/주문서로 연결(C2·C3 재사용).
UI: ContentLayout(sidebar=결제 예상금액, actionBar=담기·바로주문, detail=서비스 안내 섹션).
  넥타이 항목 다중 입력·일괄 적용·전체선택은 shared 폼 컴포넌트 조합. 일괄 적용은 ResponsiveModal.
착수 전: 이미지 업로드(서명 URL 발급→업로드) 경로와 다중 항목 상태 관리를 제안.
```

## C5 — custom-order (주문 제작 + 맞춤 결제)

```
[C5: custom-order] /custom-order 및 맞춤 결제(/order/custom-payment) 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/custom-order/index.tsx, features/custom-order/**,
  widgets/checkout/ui/OrderCheckoutPage.tsx
데이터: /orders/custom/calculate(실시간 견적), /orders/custom(생성), 결제는 C3 Toss 위젯·composite 재사용.
  100개 이상은 견적 요청 모드.
UI: ContentLayout(sidebar=주문 요약+견적, actionBar=주문/견적요청). 위저드 스텝(수량/원단/봉제/사양/마감/첨부)은
  섹션 스크롤 방식, 검증 실패 시 해당 섹션으로 스크롤.
착수 전: calculate 디바운스·견적 모드 분기·스텝 검증 흐름을 제안.
```

## C6 — sample-order (샘플 제작 + 샘플 결제)

```
[C6: sample-order] /sample-order 및 샘플 결제(/order/sample-payment) 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/sample-order/index.tsx,
  widgets/checkout/ui/SampleOrderCheckoutPage.tsx, SampleOrderEstimate.tsx
데이터: /orders/sample(생성), 결제는 C3 composite 재사용.
UI: C5와 동일 패턴(ContentLayout sidebar+actionBar). 샘플 특화 옵션·견적만 차이.
착수 전: C5와 공유 가능한 부분(견적 카드·결제 페이지 골격) 재사용 계획을 제안.
```

## C7 — token/purchase (토큰 구매 + 결제)

```
[C7: token] /token/purchase 및 /token/purchase/payment·success·fail 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/token-purchase/index.tsx,
  widgets/token-payment/ui/TokenPaymentRoute.tsx, pages/token-purchase/{success,fail}.tsx
데이터: /tokens/plans, /tokens/balance, /tokens/orders(구매), 결제는 C3 Toss 위젯 재사용.
UI: ContentLayout(슬롯 없음) + 본문을 <Box maxWidth={1024} mx="auto">로 감싼 중앙 컬럼 + 플랜 카드 그리드.
착수 전: 플랜 표기·잔액 표시·결제 재사용 계획을 제안.
```

## C8 — my-page 허브 + 내 정보/배송지

```
[C8: my-page] /my-page(허브), /my-page/my-info(및 하위 detail/email/notice/leave), 배송지 관리 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/my-page/index.tsx, pages/my-page/my-info*, features/shipping/**
데이터: /users/me, /users/me/addresses(CRUD), /users/me/notification-preferences, /auth/logout, 회원 탈퇴.
UI: ContentLayout(sidebar 재사용). 로그인 필요 → ProtectedRoute.
착수 전: 마이페이지 정보 구조·배송지 팝업(ResponsiveModal) 흐름을 제안.
```

## C9 — 주문 내역 (목록/상세/수선 배송/클레임)

```
[C9: orders] /order/order-list, /order/:id, /order/repair-shipping/:orderId, /order/claim-list,
  /order/claim/:type/:orderId/:itemId, /order/claim-detail/:claimId 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/order/{order-list,detail,repair-shipping}.tsx, pages/claim/**
데이터: /orders, /orders/{id}, /orders/{id}/repair-tracking, /orders/{id}/repair-no-tracking, /orders/{id}/confirm-purchase.
UI: ContentLayout. 목록=카드/리스트, 상세=섹션. 전부 ProtectedRoute.
착수 전: 클레임 타입 분기·수선 송장 접수 흐름을 제안.
```

## C10 — 토큰 내역 + 문의 + 견적 요청

```
[C10: my-page 확장] /my-page/token-history, /my-page/inquiry, /my-page/quote-request(및 :id) 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/my-page/{token-history,inquiry,quote-request}*
데이터: /tokens/orders, /tokens/refundable-orders, /tokens/refund-requests(+cancel), 문의/견적 관련 엔드포인트.
UI: ContentLayout. 견적 상세는 lazy. 전부 ProtectedRoute.
착수 전: 토큰 환불 요청·문의 폼 흐름을 제안.
```

## C11 — 정적 페이지 (순서 무관)

```
[C11: static] /faq, /notice, /privacy-policy, /terms-of-service, /refund-policy 구현.
참고(복사 금지): ../git/YeongSeon/apps/store/src/pages/{faq,notice,privacy-policy,terms-of-service,refund-policy}/**
데이터: 공지/FAQ는 해당 조회 엔드포인트, 약관 3종은 정적 콘텐츠.
UI: ContentLayout(슬롯 없음) 또는 좁은 중앙 컬럼 + shared Accordion/Article/List.
  약관류는 AppLayout에서 Header/Footer 숨김 정책이 필요할 수 있음 — 필요 시 C12와 함께 처리 제안.
착수 전: 약관 팝업 vs 페이지 표기 방식을 제안.
```

## C12 — design (별도 기획 선행 — 단순 포팅 아님)

> 빌드 프롬프트 이전에 **기획·설계 세션**이 먼저다. CHECKLIST §5 "`/design` 신규 기획·설계"는 seamless 플로우 기준 재설계(보존 예외)이며, 이연 기능 목록은 `docs/specs/worker-refactor.md` "범위 밖" 표 참조.
> 선행 결정: (1) AppLayout에 "전체높이 모드 + Footer 숨김" 추가(현재 없음), (2) 캔버스 레이아웃은 ContentLayout 미사용 — LayoutContent+Flex로 직접 조립, (3) design 세션 상태·생성/파이널라이즈 폴링 UX.
> 데이터: /design/sessions, /design/generate, /design/jobs/{id}, /design/sessions/{id}/turns·motifs·finalize·export.
```
[C12-기획] /design 재설계 기획. 참고: ../git/YeongSeon/apps/store/src/pages/design/index.tsx + worker 계약(docs/specs/worker-refactor.md).
산출: 화면 흐름·상태·폴링 UX·AppLayout 변경안 문서(docs/plans/store-design.md). 구현은 승인 후 별도 세션.
```
