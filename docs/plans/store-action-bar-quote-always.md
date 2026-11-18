# 스토어 액션 바 정리 — 주문 제작은 수량과 무관하게 구매·견적을 함께 둔다

스토어 세 화면(상품 상세·수선·주문 제작)의 하단 액션 바를 한 패턴으로 맞춘다. 핵심 변경은 주문 제작에서
"100개 이상이면 견적으로 자동 전환"을 없애고, 수량과 관계없이 **견적하기(프라이머리) · 구매하기(세컨더리) ·
견적서 메일(아이콘 버튼)** 세 개를 상시 노출하는 것이다. 견적 요청 API의 최소 수량(100)을 내려야 하므로
명세(`docs/api-spec/domains.md`) 갱신이 포함된다. 견적 연락처·배송지는 주문서에서 빼고 새 **견적 요청 페이지**에서 받는다.
아래 "결정" 두 가지는 2026-11-18에 확정했다.

이 플랜의 실패 모드: 견적 접수를 새 페이지로 옮기면서 접수에 필요한 값(사양·수량·참고 이미지·추가 요청)을 하나라도 빠뜨려,
주문서에서 고른 것과 다른 내용이 견적으로 접수되는 것.

## 기준 패턴 (상품 상세)

`apps/store/src/pages/shop/detail.tsx:555` `ProductActions` — `Grid templateColumns="3.25rem minmax(0, 1fr) minmax(0, 1fr)"`
한 줄에 `[찜 아이콘 버튼(iconOnly, 아이콘 + captionSm 숫자)] [장바구니(neutralOutline, ShoppingBagIcon + 텍스트)] [구매하기(brandSolid)]`.
나머지 두 화면을 이 배치에 맞춘다.

## 왜 필요한가

- 수선(`apps/store/src/pages/reform/index.tsx:379`)의 "장바구니 담기" 버튼에만 아이콘이 없다. 상품 상세는 `ShoppingBagIcon`이 있다.
- 주문 제작(`apps/store/src/pages/custom-order/index.tsx:506`)만 `VStack`으로 버튼을 위아래로 쌓는다. 다른 두 화면은 가로 한 줄이다.
- 견적 진입이 수량 100에 묶여 있어, 100개 미만 손님(기업 소량 주문 등)은 견적을 요청할 수 없고 99↔100을 오갈 때마다
  화면 구성(연락처·배송지 칸, 요약 문구, 버튼 문구)이 통째로 바뀐다.

## 결정 (2026-11-18 확정)

1. **100개 이상 바로 결제 — 확정(2026-11-18): 막지 않고, 결제 전에 확인 창으로 견적을 권한다.**
   주문 API는 이미 1~10,000개를 받으므로(`docs/api-spec/money.md:55`) 서버 변경은 없다. 근거:
   - 차단의 원래 목적은 대량 결제의 토스 수수료 회피였다. 그런데 디자인이 다르면 주문을 나눠야 한다(디자인마다 제직 기초
     비용이 들어 한 주문에 여러 디자인을 넣을 수 없다). 그래서 큰 주문일수록 디자인별 100개 미만으로 들어와 차단을 지나간다.
     차단이 실제로 막는 건 단일 디자인 100개 이상뿐이고, 이런 손님은 대개 먼저 문의한다(운영자 판단, 실측 없음).
   - 그래도 100개 이상을 돈부터 받으면 두 가지가 걸린다. (a) 원단 재고·직기 일정·납기를 확인하지 않고 제작 기간을 약속하게 된다.
     (b) 카드 결제 건에는 세금계산서를 발급하지 않는다(부가가치세법 제33조 제2항 — 카드 매출전표가 세금계산서를 대신한다).
     카드 매출전표도 부가세가 구분돼 있으면 매입세액공제가 되므로 손님이 세무상 손해를 보지는 않는다(같은 법 제46조 제3항).
     토스 매출전표에 공급가액·부가세가 따로 표시되는 것은 운영자가 2026-11-18에 확인했다.
     다만 사내 규정상 세금계산서가 꼭 필요하거나 후불 계좌이체로 처리하는 기업은 결제 뒤에 취소·재결제가 필요해진다.
     그래서 확인 창은 "카드로는 증빙이 안 된다"가 아니라 "계좌이체·세금계산서로도 결제할 수 있다"는 선택지로 쓴다.
   - 그래서 막지 않고 고지한다. 결제하려는 손님은 그대로 결제하고, 일정·세금계산서가 필요한 손님은 견적으로 간다.
2. **견적 연락처·배송지는 새 견적 요청 페이지에서 받는다.** 구매하기가 주문서 내용을 들고 결제 페이지
   (`/order/custom-payment`)로 넘어가듯, 견적하기는 견적 요청 페이지(`/custom-order/quote`)로 넘어간다. 근거:
   - 주문서에서 견적용 칸이 빠져 구매자 화면이 깔끔해지고, 구매·견적의 입력 검증을 한 파일에서 갈라 쓰지 않아도 된다.
   - 페이지라서 기존 `AddressSelectModal`을 그대로 쓴다(모달로 만들면 모달 위 모달이 된다).
   - 접수 버튼이 곧 확인 단계라 "견적을 요청할까요?" 확인 창이 필요 없어진다.
   - 연락처 기본값(운영자 확인): 회원 정보에 있으면 미리 채우고, 없으면 빈칸이다. 지금 주문서의 규칙
     (`custom-order/index.tsx:222-237`)을 그대로 옮긴다 — 이름은 회원 이름, 연락 수단은 전화번호가 있으면 전화·없으면 이메일,
     값은 전화번호 → 이메일 → 빈칸 순. 업체명은 항상 빈칸에서 시작한다.

## 범위 밖

- 결제 페이지·장바구니 페이지의 버튼.
- 계측 이벤트 추가. 구매하기·대량 확인 창 선택을 따로 세지 않는다 — 되돌릴 신호는 관리자 주문 목록으로 본다(아래 상향 신호).
  기존 `quote_request` 이벤트(`custom-order/index.tsx:410`)는 그대로 둔다.
- 견적서 메일 내용·발송 경로(실행 완료 — `docs/reviews/logo-light-help-email-estimate-mail-2026-11-18.md`).
- `ActionButton`에 새 variant나 토큰을 추가하는 일. 기존 `brandSolid`·`neutralOutline`·`neutralWeak`로 충분하다.

## 실행 조건

- 절차 2(API 하한)는 절차 3·4와 같은 PR이거나 그보다 먼저 배포돼 있어야 한다. 프론트가 먼저 나가면 100개 미만 견적하기가
  서버 400으로 실패한다.
- 절차 6은 절차 4 뒤에 실행한다(같은 PR이어도 된다). 견적서 내용(부가세 포함·입금 계좌·업태)은 2026-11-18에 운영자가
  확인했다. 운영 발송 확인은 기다리지 않는다 — 버튼은 이미 운영에 나와 있고, 도착하지 않으면 그때 버그로 고치기로 했다
  (운영자 결정 2026-11-18).

## 절차

각 항목은 따로 실행·검증할 수 있다. 1은 단독 PR로 먼저 내도 된다.

1. **수선 장바구니 버튼에 아이콘** — `apps/store/src/pages/reform/index.tsx:379` 버튼 children 앞에 `<Icon svg={<ShoppingBagIcon />} size={18} />`.
   import는 `shop/detail.tsx:31`과 같은 `@heroicons/react/24/outline`. (선택) 문구를 상품 상세와 같이 "장바구니"·"구매하기"로
   맞춘다. 지금은 "장바구니 담기"·"바로주문"이다.
2. **견적 요청 최소 수량 100 → 4 (API + 명세)** — `apps/api/src/api/domains/quotes/service.py:106`의 `< 100`을 주문 제작 최소 수량과
   같은 `< 4`로, 에러 문구도 맞춘다. `docs/api-spec/domains.md:70`의 `100 ≤ quantity`를 `4 ≤ quantity`로 고친다.
   `apps/api/tests/test_quotes.py:50`의 기존 하한 테스트(99 → 400, 문구 "Quantity must be 100 or more")를 새 경계로 고친다
   (3 → 400 `invalid_quantity`, 4 → 성공). `DomainError` 기본 상태는 400이다(`apps/api/src/api/errors.py:28`). 하한은 서비스
   코드에만 있고 스키마(`quotes/schemas.py:21`)에는 상한뿐이라 codegen 변화는 없을 것이다 — `pnpm codegen`으로 확인하고,
   생성물이 바뀌면 같은 커밋에 넣는다.
3. **견적 요청 페이지 신설 + 주문서에서 견적 모드 제거**
   - **새 페이지** `apps/store/src/pages/custom-order/quote.tsx`, 경로 `custom-order/quote`. 라우터
     (`apps/store/src/app/router/index.tsx:142`)의 `order/custom-payment`와 같은 그룹에 같은 `lazy` 형태로 등록한다.
     이 그룹은 `ProtectedRoute`(`:113`) 아래라 로그인 없이는 들어올 수 없다.
     틀은 `apps/store/src/pages/order/custom-payment.tsx`를 본뜬다 — `location.state`의 초안을 `parseCustomQuoteDraft`(아래)로 읽고,
     없으면(새로고침·직접 진입) `/custom-order`로 `Navigate replace`. state 키는 `customQuote`.
   - 레이아웃은 `ContentLayout`(`apps/store/src/shared/ui/AGENTS.md` 먼저 읽을 것). 본문: 연락처 칸(주문서 `:672` 블록을 옮긴다 —
     담당자 성함·업체명·연락 수단·연락처)과 배송지 카드(`:1084` 블록 + `AddressSelectModal`, 기본값은 첫 배송지).
     사이드바: `SummaryCard`에 `customOrderSummary(draft.options)` 행, 추가 요청, 참고 이미지 개수, "예상 견적" 합계
     (`draft.totalCost`), 그리고 "담당자가 사양을 확인한 뒤 최종 견적을 안내합니다. 계좌이체·세금계산서로 결제할 수 있어요." 고지.
     actionBar: "견적 요청하기" 한 개(brandSolid).
   - 연락처 초기값은 결정 2의 규칙대로 회원 정보에서 채운다(주문서 `:222-237` 효과를 옮긴다). 없으면 빈칸.
   - 검증은 기존 `invalidCustomOrderSection(draft.options, contact, true)`를 그대로 부른다 — 사양은 주문서에서 이미 통과했으므로
     연락처 오류만 나온다. 배송지가 없으면 배송지 카드로 스크롤한다(주문서 `:314-320` 동작을 옮긴다).
   - 접수는 주문서의 `submitQuote`(`:390`~)를 옮긴다. 본문의 사양은 결제 페이지와 같이 `customOrderApiOptions(draft.options)`로
     만들고(`pages/order/custom-payment.tsx:52` — 초안에는 화면 값이 들어 있고 서버용 정리는 이 함수가 한다), `draft.imageRefs`·수량·
     추가 요청을 그대로 싣는다
     (실패 모드 주의 — 필드 목록은 `:397-407`의 요청 본문과 한 줄씩 대조한다). 성공하면 지금처럼 주문서 임시 저장을 지우고
     (`clearCustomOrderFormDraft(user.id)` — 이 페이지는 항상 로그인 상태다), `quote_request` 이벤트, 목록 무효화, snackbar, `/my-page/quote-request` 이동.
   - **주문서**(`apps/store/src/pages/custom-order/index.tsx`)에서 지우는 것: `:171` `wasQuoteMode`, `:181` `isQuoteMode`,
     `:240-245` 100개 전환 snackbar, `:183-185` 배송지 조회와 `:194-197` 기본 배송지 효과, `address`·`addressModalOpen`·
     `quoteConfirmOpen` state, `:222-237` 회원 정보 효과, `:672` 연락처 블록, `:1084` 배송지 블록, `AddressSelectModal`,
     `:1119` 견적 확인 `AlertDialog`, `submitQuote`, `createQuote`, 연락처용 ref.
   - **연락처를 임시 저장·초안에서 뺀다** (`apps/store/src/features/custom-order/model/draft.ts`, `model/options.ts`). 주문서는
     연락처를 더 이상 다루지 않으므로 빈 값을 채워 넣는 대신 항목을 없앤다.
     - `formDraftSchema`(`draft.ts:57`)·`orderDraftSchema`(`:70`)·`CustomOrderFormDraft`(`:89`)·`CustomOrderDraft`
       (`options.ts:41`)에서 `contact`를 지우고, `isEmptyCustomOrderFormDraft`(`draft.ts:160`)의 연락처 비교도 지운다.
     - 저장 키 `CUSTOM_ORDER_DRAFT_KEY`(`draft.ts:11`)를 `v3` → `v4`로 올린다. 임시 저장은 `sessionStorage`라 배포 순간 주문서를
       열어 둔 탭의 입력만 사라진다 — 운영자가 2026-11-18에 감수하기로 했다.
     - `contactSchema`·`QuoteContact`·`DEFAULT_QUOTE_CONTACT`는 견적 요청 페이지가 쓰므로 남긴다. 견적 요청 페이지는 연락처를
       저장하지 않고 진입할 때마다 회원 정보에서 채운다.
     - 견적 요청 페이지로 넘기는 초안은 결제 초안과 **모양이 다르다** — 견적의 참고 이미지는 `{object_key, part?}`
       (`ReferenceImageIn`)이고 결제는 `{upload_id, part?}`(`OrderReferenceImageIn`)다(`features/custom-order/api/upload.ts:48-50`).
       그래서 `parseCustomOrderDraft`를 재사용하지 않고 `draft.ts`에 `customQuoteDraftSchema`(사양은 `orderOptionsSchema`,
       `imageRefs`는 `object_key` 문자열 최대 1,024자 + 선택 `part`, `totalCost`)와 `parseCustomQuoteDraft`를 추가한다.
       타입 `CustomQuoteDraft`는 `options.ts`의 `CustomOrderDraft` 옆에 둔다.
     - 감수하는 부수 효과: 결제 실패 뒤 `returnState`로 결제 페이지에 돌아올 때 초안을 `orderDraftSchema`(strict)로 다시 읽는다
       (`pages/order/custom-payment.tsx:16`). 배포 순간 결제창에 있던 손님이 결제에 실패하면 옛 초안(연락처 포함)이 걸러져
       주문서로 돌아간다. 돈은 빠지지 않은 상태이고 배포 순간에만 생기므로 호환 처리는 넣지 않는다.
     - 테스트 수정: `model/draft.test.ts:18`·`:83-110`, `pages/order/payment-success.test.tsx:139-175`,
       `pages/custom-order/index.test.tsx:90-135`("stale A 사용자…" — 수량 100에서 담당자 성함 칸에 입력해 초안을 구별한다)가
       `contact.contactName`에 기대고 있다. `options.additionalNotes` 같은 사양 필드로 구별하도록 바꾼다. `draft.test.ts`에
       `parseCustomQuoteDraft` 케이스 하나를 더한다(`object_key` 초안은 통과, `upload_id` 초안은 null).
     - 주문서의 `invalidCustomOrderSection` 호출은 인자 한 개(사양만)로 줄이고, `EstimateEmailModal`의 `defaultCompanyName`
       (`:1116`)에는 빈 문자열을 넘긴다.
   - 버튼 핸들러: `requestSubmit`(`:305`)을 둘로 나눈다. 둘 다 `validate()` → `requireAuth` 순서는 지금과 같다.
     - `requestPurchase`: 수량이 `BULK_CONFIRM_QUANTITY`(100, 파일 상단 상수) 이상이면 대량 확인 창, 아니면 `submitOrderDraft`.
     - `requestQuote`: `uploadQuoteImages()`(kind `quote_request`)로 참고 이미지를 올린 뒤 초안을 들고
       `/custom-order/quote`로 이동한다(state 키 `customQuote`). `submitOrderDraft`(`:367`~)와 같은 모양이다.
   - 요약 카드(`:452`·`:484`·`:488-492`)는 "주문 요약"·"예상 금액" 한 가지 문구로 고정한다. Callout은 제작 기간·취소 불가 고지만 남긴다.
   - 대량 확인 창: `AlertDialog` 하나(state `bulkConfirmOpen`). 문구 예: 제목 "견적으로 요청하시겠어요?", 설명 "100개 이상은 견적으로
     요청하면 생산 일정을 먼저 확인해 드리고, 계좌이체·세금계산서로 결제할 수 있어요." 버튼: primary "견적하기"(창을 닫고
     `requestQuote`), secondary "그대로 결제"(`neutralOutline`, 창을 닫고 `submitOrderDraft`).
   - 테스트 하나: `apps/store/src/pages/custom-order/quote.test.tsx` — 회원 정보에 전화번호가 있으면 연락처가 채워지고, 이름·전화·
     이메일이 모두 없으면 빈칸이며, 빈칸으로 접수를 누르면 접수 요청이 나가지 않는다.
4. **주문 제작 액션 바를 상품 상세 배치로** — `custom-order/index.tsx:506`의 `VStack`을 `ProductActions`와 같은 3열 `Grid`로 바꾼다.
   - 1열: 견적서 메일 — `ActionButton variant="neutralWeak" size="large" iconOnly aria-label="견적서 메일로 받기"`.
     찜 버튼처럼 `VStack` 안에 `EnvelopeIcon`(18)과 `captionSm` 라벨 "견적서"를 둔다. `disabled={!priceReady}`는 유지한다.
   - 2열: 구매하기 — `neutralOutline`, `width="full"`, `onClick={requestPurchase}`. 금액은 요약 카드에 있으니 버튼 문구에
     넣지 않는다(지금 `"N원 주문하기"`인데 반쪽 폭에서는 잘린다).
   - 3열: 견적하기 — 기본 variant(brandSolid), `onClick={requestQuote}`.
   - `:522` "배송지와 연락처 확인 후 접수됩니다" caption은 지운다. 견적 요청 페이지가 그 단계를 대신한다.
   - 부수 효과: 모바일 하단 바가 두 줄에서 한 줄로 줄어 `ScrollTopButton`이 가정하는 76px 높이
     (`apps/store/src/shared/ui/scroll-top-button.tsx:14`)와 맞게 된다. 높이 보정은 따로 하지 않는다.
5. **100 기준을 말하는 안내 문구 정리**
   - `custom-order/index.tsx:615` HelpBubble: "최소 4개부터 주문할 수 있습니다. 바로 구매하거나 담당자 견적을 요청할 수 있습니다."
   - `apps/store/src/features/custom-order/ui/custom-order-service-guide.tsx`: `:144` FAQ 답을 "4개부터 주문할 수 있어요. 주문서에서
     바로 결제하거나 견적을 요청할 수 있어요."로, `:197` 히어로 알약을 "견적 요청 가능"으로(절차 6을 실행할 때 "엑셀 견적서 메일"로
     다시 바꾼다), `:259` 가격 섹션 칸을 `["견적", "수량 관계없이 요청"]`으로 바꾼다. `:30` 가격 예시 수량 100은 예시일 뿐이라 그대로 둔다.
   - `apps/store/src/pages/my-page/quote-request.tsx:94` 빈 상태: "주문 제작에서 견적을 요청할 수 있습니다."
   - `:91` 수량 프리셋의 100은 그대로 둔다(빠른 선택일 뿐이다).

6. **정보 탭에 견적서 메일 소개 섹션** — 절차 4 뒤에 실행한다.
   - 위치: `apps/store/src/features/custom-order/ui/custom-order-service-guide.tsx`의 가격 섹션(`:205`~`:281`) 바로 다음에 새
     `GuideSection`. 가격을 본 손님에게 "이 금액을 결재용 견적서로"로 잇는 흐름이다.
   - 히어로 알약(`:197`)을 절차 5에서 넣은 "견적 요청 가능"에서 "엑셀 견적서 메일"로 바꾼다.
   - 구성: Eyebrow "견적서", 제목 "결재용 견적서, 엑셀로 바로 받아보세요", 설명 한 줄(사양을 고르고 메일 버튼을 누르면
     엑셀 견적서를 보낸다, 금액은 주문서와 같은 기준, 로그인 필요). 그림 두 개를 `Grid columns={{ base: 1, md: 2 }}`로.
     1. 버튼: 캡처하지 않고 절차 4의 견적서 메일 버튼과 같은 `ActionButton`을 렌더한다(디자인이 바뀌어도 따라간다).
        누르면 `onStart`(주문서 맨 위로 스크롤)를 부른다.
     2. 견적서: 엑셀 캡처 이미지 — **준비됨**. `apps/store/public/images/custom-order/estimate-sample-2026-11-18.webp`
        (973×936, 2026-11-18에 운영자가 찍은 캡처를 견적서 표 영역만 잘라 `cwebp -q 78`로 변환). 예시 업체명 "(주)샘플상사",
        기본 사양 100개, 합계 1,610,000원(예시 금액). 세금계산서 입금 계좌 줄은 잘라 냈다. `ImageFrame`에 `ratio={973 / 936}`으로
        넣고 alt는 "맞춤 넥타이 견적서 엑셀 예시". 교체할 때는 파일명을 바꾼다(`apps/store/AGENTS.md` 에셋 규칙).

7. **마무리** — 실행 결과를 `docs/reviews/`에 기록하고 이 문서를 지운다(`docs/plans/AGENTS.md`). 견적서 캡처를 못 받아 6만
   남으면 이 문서에 6만 남긴다.

## 검증

- `pnpm lint && pnpm typecheck && pnpm --filter store test`
- `uv run pytest apps/api/tests/test_quotes.py`
- `pnpm codegen` 뒤 `git status`에 `packages/api-client` 변경이 없다(절차 2).
- e2e(`e2e/store-money-path.spec.ts`)는 상품 상세·장바구니 버튼만 누르므로 이 변경으로 깨지지 않는다 — 돌릴 필요 없다.
- 브라우저(store :3000 `/custom-order`, 사용자가 띄워 둔 경우만): 수량 4에서 세 버튼이 한 줄로 보이고 주문서에 연락처·배송지 칸이
  없다. 구매하기 → 결제 페이지. 견적하기 → `/custom-order/quote`에 사양 요약·예상 견적이 보이고, 연락처가 회원 정보로 채워져 있다
  (전화번호 없는 계정은 이메일, 둘 다 없으면 빈칸). 연락처를 지우고 접수 → 해당 칸에 오류, 채우고 접수 →
  `/my-page/quote-request`에 QUO- 건 생성. 접수된 건의 사양·수량·참고 이미지가 주문서에서 고른 것과 같다(관리자 견적 상세로 대조).
- `/custom-order/quote`에서 새로고침 → `/custom-order`로 돌아오고 주문서 사양이 임시 저장에서 복원된다.
- 99↔100을 오가도 주문서 화면 구성이 바뀌지 않는다. 모바일 폭(375px)에서 3열이 잘리지 않는다.
- 수량 99에서 구매하기 → 확인 창 없이 결제 페이지. 수량 100에서 구매하기 → 대량 확인 창. "그대로 결제" → 결제 페이지,
  "견적하기" → 견적 요청 페이지.
- `/reform` 장바구니 버튼에 가방 아이콘이 보인다.
- 정보 탭 가격 섹션 다음에 견적서 섹션이 보이고, 섹션의 버튼을 누르면 주문서 맨 위로 올라간다. 견적서 이미지의 글자가
  모바일 폭(375px)에서 읽힌다.
- 배포 뒤: 운영 `/custom-order`에서 견적서 메일을 본인 주소로 한 번 보내 받은편지함 도착과 첨부 합계 = 화면 금액을 본다.
  도착하지 않으면 6을 되돌리지 않고 발송 버그로 따로 고친다.

## 되돌리는 법 / 상향 신호

- 견적 요청이 소량(4~99개) 건으로 넘쳐 담당자 처리가 밀리면 2의 하한을 다시 올린다(서버 한 줄 + 명세 + 테스트).
  이때 프론트 `requestQuote`에도 같은 하한 검증과 안내 문구를 넣는다 — 그대로 두면 서버의 영문 400 메시지가 snackbar에 뜬다.
- 확인 창을 지나 100개 이상 카드 결제가 자주 들어오고, 일정 초과로 인한 환불이나 세금계산서 재결제 CS가 생기면 차단으로
  되돌린다(100개 이상 구매하기 비활성). 신호는 관리자 주문 목록에서 100개 이상 맞춤 주문 건수로 본다.
- 반대로 기준이 수량이라 비싼 사양 소량 주문은 확인 창에 안 걸린다. 그런 건에서 같은 CS가 생기면 기준을 결제 예상 금액으로 바꾼다.

## 기각한 대안

- **100개 이상 구매하기 차단 유지** — 수수료 회피 효과가 적고(위 결정 1), 바로 결제하려는 손님을 기다리게 한다. 위 상향 신호가 나오면 재론한다.
- **100개 이상도 아무 안내 없이 결제 허용** — 생산 일정·세금계산서 문제를 결제 뒤에야 알게 된다. 확인 창 비용이 작아 고지를 택했다.
- **디자인이 여러 개인 주문을 한 건으로 묶는 기능** — 디자인마다 제직 기초 비용이 들어 한 주문으로 작업할 수 없고, 작업량도 크다.
- **견적 연락처·배송지 칸을 주문서에 항상 보이게 둔다** — 작업은 가장 작지만 구매자 화면에 견적용 칸이 끼어든다. 견적 요청
  페이지의 이탈이 눈에 띄게 높으면(견적하기 클릭 대비 접수 건수) 재론한다.
- **견적하기를 누르면 연락처·배송지 Modal을 연다** — 배송지 변경이 `AddressSelectModal`을 다시 열어서 "모달 위 모달 금지"
  (`packages/shared/AGENTS.md` 오버레이 규칙)에 걸린다. 페이지로 풀었으므로 재론하지 않는다.
- **참고 이미지를 견적 요청 페이지에서 접수할 때 올린다** — 파일을 페이지 이동 너머로 들고 가야 한다. 결제 흐름과 같이 이동 전에
  올린다. 접수하지 않고 나가면 올린 스테이징 이미지가 남는데, 결제 흐름도 지금 같다.
- **견적서 메일을 텍스트 버튼으로 남기고 4개를 두 줄로** — 이번 요청의 목적(한 줄 배치 통일)과 어긋난다.
