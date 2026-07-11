# store 토큰 내역·문의·견적(C10) 구현 플랜

> YeongSeon `/my-page/token-history` + `/my-page/inquiry` + `/my-page/quote-request`(및 `:id`)를 essesion store로 재작성.
> **상태: 완료 (2026-07-11)** — D1~D11 구현·검증 완료. §3(토큰 환불 요청 흐름)·§4(문의 폼 흐름)의 착수 전 제안을 그대로 적용했다.
> 원본 참고(복사 금지): `../git/YeongSeon/apps/store/src/pages/my-page/{token-history,inquiry,quote-request}*`, `features/order/components/token-refund-action.tsx`, `features/my-page/inquiry/**`, `entities/{design,inquiry,quote-request}/**`.

## 1. 범위 (라우트)

| 경로 | 성격 | 내용 |
|---|---|---|
| `/my-page/token-history` | 신규 | 토큰 잔액(sidebar) + 변동 내역(무한 스크롤) + 구매 주문별 **환불 신청/취소**(§3) |
| `/my-page/inquiry` | 신규 | 1:1 문의 목록 + 요약(sidebar) + 작성/수정 ResponsiveModal(§4) |
| `/my-page/quote-request` | 신규 | 견적 요청 목록 — 조회 전용, 날짜 그룹핑 + 상태 Chip 필터 |
| `/my-page/quote-request/:id` | 신규 | 견적 상세 — 조회 전용. custom-order 사양 렌더 의존 때문에 **상세 전용 청크**(D9) |

전부 기존 ProtectedRoute 그룹(`app/router/index.tsx`)에 lazy로 추가(라우터는 전 라우트 lazy 컨벤션 — 상세는 목록과 import를 분리해 청크가 실제로 나뉘게 유지). 허브(`/my-page`)에 링크 3행 추가(§8 D11).

## 2. 원본 명세 요약 (보존 대상 = "무엇을 하는가")

- **token-history**: 잔액 카드(총/유료/보너스) + 변동 내역 리스트(사용·환불, +/- 색 구분, 키워드·날짜 필터, 50개 단위 더 보기). **환불 신청 UI는 이 페이지가 아니라 주문 내역에 있었음** — 조건별 분기: 신청 가능 → 확인 다이얼로그(주문번호·유료 토큰·환불 금액, 사유 입력 없음, "가장 최근 구매를 하나도 사용하지 않은 경우에만" 안내) / 신청 중 → 배지+취소 링크 / 완료·불가 → 배지·사유.
- **inquiry**: 요약 4칸(전체/답변 대기/답변 완료/최근 답변일) + 카드 목록(상태 배지, 카테고리, 제목·내용, 상품 썸네일, 답변 블록). 작성 폼: 카테고리 칩(일반/상품/수선/주문제작) + "상품"일 때만 상품 검색·선택 + 제목 + 내용. 첨부 없음. **답변대기 상태에서만 수정·삭제 가능**. 데스크톱은 사이드 패널 인라인 폼, 모바일은 시트. `?category=&productId=` 프리필 진입 지원.
- **quote-request**: 주문 제작 상담 요청의 결과 열람(생성 폼은 custom-order 쪽 — C5에서 구현 완료). 목록: 날짜 그룹핑 카드(상태 배지, 견적번호, 수량, 담당자, 연락 방법, 견적 금액). 상세: 기본 정보·연락처·제작 사양 카드·요약(상태/견적 금액/견적 조건). 상세가 무거운 이유 = custom-order 가격·라벨 모듈 의존 → 원본도 lazy.
- 허브 진입점: [주문과 내역] 견적 요청 내역·토큰 내역, [고객지원] 1:1 문의 내역.

## 3. 토큰 환불 요청 흐름 제안 (착수 전 제안 ①)

원본은 잔액·내역(token-history)과 환불 액션(주문 내역)이 두 페이지에 분산돼 있고, essesion은 이미 `/my-page/orders`에 "토큰" 필터, `/my-page/claims`(+상세)에 token_refund 표시·**취소 배선**(`claim-detail.tsx:217-231`, `cancelTokenRefundMutation`)이 있다. C10은 **token-history를 토큰 단일 허브**로 만들고, 이미 있는 클레임 화면과 중복되는 UI는 만들지 않는다:

```text
/my-page/token-history ── ContentLayout(breadcrumbs, sidebar)
  sidebar(SummaryCard "토큰 잔액")
   ├ 총 잔액 / 유료 / 보너스 (GET /tokens/balance)
   └ [토큰 충전] → /token-purchase
  본문
   ├ [구매와 환불]  GET /tokens/refundable-orders — 토큰 주문 카드 목록
   │   카드: 주문번호 · 결제금액 · 지급 유료 토큰 · 유효기간
   │   reason별 분기:
   │    ├ null+is_refundable   → [환불 신청] → AlertDialog(주문번호·유료 토큰·환불 금액
   │    │     + 안내 ①최근 구매 미사용분만 ②신청 중에는 토큰 사용이 차단됨(refund_pending))
   │    │     → POST /tokens/refund-requests → snackbar + invalidate
   │    ├ pending_refund → Badge "환불 신청 중" + [신청 취소](AlertDialog →
   │    │     POST /tokens/refund-requests/{claim_id}/cancel) + 클레임 상세 링크(D2의 claim_id)
   │    ├ approved_refund → Badge "환불 완료"
   │    └ expired/not_latest/tokens_used/유료 0 → 사유 캡션(비활성)
   └ [변동 내역]  GET /tokens/history(D1 신설) — useInfiniteQuery(50개, shop 패턴)
       Chip 필터(전체/구매·지급/사용/환불) + 날짜 그룹핑, 증감액 +/- tone
```

- **취소를 카드 인라인으로도 두는 이유**: 신청 직후 마음을 바꾸는 자리가 바로 이 페이지다. 뮤테이션은 claim-detail과 동일 생성물을 재사용하므로 중복 로직 없음. 상태 이력이 필요하면 클레임 상세 링크로.
- 신청·취소 성공 시 invalidate: `listRefundableTokenOrders` + `getTokenBalance` + `listMyClaims` + 토큰 내역(D1). 서버가 접수 중 토큰 사용을 `refund_pending`으로 차단하므로(ledger.py:78-89) 다이얼로그 안내문에 반드시 포함.
- 원본의 내역 키워드 검색·날짜 범위 입력은 **제거**(D6) — essesion my-page 컨벤션(Chip 필터 + 날짜 그룹핑)으로 대체. 원장 특성상 페이지네이션은 유지(무한 스크롤).

## 4. 문의 폼 흐름 제안 (착수 전 제안 ②)

원본의 데스크톱 사이드 패널 + 모바일 시트 이원화를 버리고, essesion 폼 표준인 **ResponsiveModal 하나**로 작성·수정을 통합한다(배송지 폼 모달과 동일 패턴):

```text
/my-page/inquiry ── ContentLayout(breadcrumbs, sidebar)
  sidebar(SummaryCard "문의 현황"): 전체 / 답변 대기 / 답변 완료 / 최근 답변일 (목록에서 파생)
  본문
   ├ [1:1 문의하기] → InquiryFormModal(ResponsiveModal)
   │   ├ 카테고리: Chip 4종(일반/상품/수선/주문제작)
   │   ├ 카테고리=상품 → 상품 검색 TextField(디바운스, shop 상품 목록 검색 재사용) → 결과 선택(썸네일+이름)
   │   ├ 제목 TextField(1..200) · 내용 TextAreaField(1..5000)
   │   └ zInquiryCreateRequest.extend(문구) + useZodForm — 저장 → snackbar + invalidate
   └ 문의 카드 목록(created_at desc, 날짜 그룹핑)
       ├ 상태 Badge(답변대기=neutral / 답변완료=positive) · 카테고리 · 제목
       ├ 카드 확장/본문: 내용 + (있으면) 연결 상품 + 답변 블록("답변 · answer_date")
       └ 답변대기일 때만: [수정](같은 모달, 초기값 주입) · [삭제](AlertDialog criticalSolid)
```

- 수정·삭제는 **서버에 엔드포인트가 없다** — 원본 명세 보존을 위해 `PATCH /inquiries/{id}` · `DELETE /inquiries/{id}`를 신설(D3, 소유자 + `답변대기`만 허용 가드). 인가 테스트는 규칙대로 testcontainers.
- `?category=&product_id=` 쿼리 프리필(폼 자동 오픈)은 파싱만 지원해 두고, 상품 상세의 "문의하기" 버튼 배선은 이연(§11) — 진입점이 아직 없음.
- 문의 목록은 페이지네이션 없음(서버도 전량 반환) — orders/claims와 동일하게 전량 + 그룹핑.

## 5. 견적 요청 화면 구성 (조회 전용)

- **목록**: `listMyQuotes` 전량 → `groupByCreatedDate` 그룹핑 + 상태 Chip 필터(요청/견적발송/협의중/확정/종료, 클라 필터). 카드: 상태 Badge(tone 매핑 신설) · `quote_number` · 수량 · 담당자(상호명 있으면 병기) · 연락 방법 라벨 · `quoted_amount`(있으면 강조). 클릭 → 상세.
- **상세**: `getQuote` — 본문: 기본 정보(요청일·수량·추가 요청사항), 연락처(담당자·상호명·방법·값), 제작 사양 카드(`options` dict → `customOrderSummary` 재사용 렌더), 참고 이미지 썸네일(확정/종료 90일 후 만료 가능 → 로드 실패 placeholder). sidebar(SummaryCard): 상태 Badge + 견적 금액 + 견적 조건. actionBar/하단: [목록으로].
- custom-order(C5)가 견적 접수 후 홈으로 보내던 것을 **`/my-page/quote-request` 이동으로 변경**(D8) — C5 플랜 D7이 예고한 마무리.
- 배송지는 `shipping_address_id`만 있고 스냅샷이 없어 표시 생략(§11 기록).

## 6. 하네스 매핑

| 원본 요소 | essesion | 근거 |
|---|---|---|
| BalanceSummary 잔액 카드 | sidebar `SummaryCard` + `Text`/`Badge` | claim-detail sidebar 선례 |
| 내역 리스트(+/-) | `List`/`ListItem` + tone 있는 `Text`, 날짜 그룹 헤더 | orders 날짜 그룹핑 선례 |
| "더 보기" 페이지네이션 | `useInfiniteQuery` + PC 더 보기 버튼 / 모바일 IntersectionObserver | shop/index.tsx:64-102 패턴 |
| 환불 확인 다이얼로그 | `AlertDialog`(진행 차단 확인) | 결제 취소로 이어지는 결정 |
| 문의 작성 패널/시트 | `ResponsiveModal` 폼 | 폼 기본 패턴(address-form-modal 선례) |
| 카테고리 선택 칩 | `Chip`(단일 선택) | 필터 칩과 동일 컴포넌트 |
| 문의/견적 상태 배지 | `Badge` + tone 헬퍼(features config) | orderStatusTone/claimStatusTone 선례 |
| 삭제 confirm | `AlertDialog` `criticalSolid` | 파괴적 액션 |
| 요약 4칸 | sidebar `SummaryCard` | ContentLayout sidebar 슬롯 |
| toast / 3상태 | `snackbar` / `Skeleton`·`ContentPlaceholder`(+재시도) | my-page 공통 규약 |

## 7. 데이터 계약

| 용도 | 엔드포인트 | api-client | 상태 |
|---|---|---|---|
| 토큰 잔액 | GET /tokens/balance | `getTokenBalanceOptions` | 있음(design 페이지 사용 중) |
| 토큰 변동 내역 | **GET /tokens/history** | (codegen) | **D1 신설** — limit/offset(50) + type 필터 |
| 환불 가능/구매 목록 | GET /tokens/refundable-orders | `listRefundableTokenOrdersOptions` | 있음 — **D2로 `claim_id` 필드 추가** |
| 환불 신청 | POST /tokens/refund-requests | `requestTokenRefundMutation` | 있음(미배선) |
| 환불 취소 | POST /tokens/refund-requests/{claim_id}/cancel | `cancelTokenRefundMutation` | 있음(claim-detail 배선 재사용) |
| 문의 목록/상세 | GET /inquiries(·/{id}) | `listMyInquiriesOptions`/`getInquiryOptions` | 있음(미배선) |
| 문의 등록 | POST /inquiries | `createInquiryMutation` | 있음(미배선) |
| 문의 수정/삭제 | **PATCH·DELETE /inquiries/{id}** | (codegen) | **D3 신설** — `답변대기`만, 소유자 |
| 상품 검색(문의 연결) | GET /products?q=&limit= | 기존 목록 생성물 | C10에서 이름 검색(`q`, 리터럴 wildcard)·`limit` 계약 보강 |
| 견적 목록/상세 | GET /quotes(·/{quote_id}) | `listMyQuotesOptions`/`getQuoteOptions` | 있음(미배선 — C5가 C10으로 이연) |

서버 변경(D1~D3)은 각각 `pnpm codegen` 동반 커밋 — CI codegen-drift 검사.

## 8. 원본 대비 결정·개선 (실행 전 확정 제안)

| ID | 결정 | 근거 |
|---|---|---|
| D1 | **서버 신설**: `GET /tokens/history` — DesignToken 원장 조회(본인, `created_at desc`, limit/offset 50, `type` 필터 선택) | 원본 기능(변동 내역)의 데이터 소스가 essesion API에 없음. 원장은 생성 1회당 행이 쌓여 전량 반환 불가 → my-page 중 유일하게 페이지네이션 채택(shop 무한 스크롤 패턴 재사용). `ix_design_tokens_user_created` 인덱스가 이미 있어 스키마 변경 없음 |
| D2 | **서버 개선**: `RefundableTokenOrder`에 `claim_id: UUID \| None` 추가(접수/완료 클레임 존재 시) | 취소 API가 claim_id를 요구하는데 현재 응답으로는 알 수 없음(원본 RPC는 pendingRequestId 제공). 판정 쿼리가 이미 Claim을 조회하므로 컬럼 하나 추가 비용뿐 |
| D3 | **서버 신설**: `PATCH /inquiries/{id}` · `DELETE /inquiries/{id}` — 소유자 + `답변대기` 상태 가드 | 원본의 "답변 전 수정·삭제" 명세 보존. 인가 테스트는 testcontainers(도메인 규칙) |
| D4 | 환불 신청·취소를 **token-history에 통합**(원본은 주문 내역에 분산) | 잔액·내역·구매·환불이 한 화면에 — 허브 부제("구매 및 환불에 따른 토큰 변동") 의미 보존. `/my-page/orders`의 토큰 필터·`/my-page/claims`의 token_refund 표시는 그대로(조회 경로 중복은 무해, 액션은 한 곳) |
| D5 | 환불 신청 사유 입력 없음 유지, 다이얼로그에 **토큰 사용 차단 안내 추가** | 원본도 `p_reason: null`. 접수 중 `use_tokens`가 `refund_pending`으로 막히는 실동작(ledger.py:78-89)을 사용자에게 예고 — 원본에 없던 안내 |
| D6 | 내역 키워드 검색·날짜 범위 입력 제거 → **Chip 타입 필터 + 날짜 그룹핑** | essesion my-page 컨벤션 통일(orders/claims 선례). description ilike 검색은 이용 빈도 대비 서버 파라미터·UI 비용이 큼 — 필요해지면 D1 엔드포인트에 파라미터만 추가 |
| D7 | 변동 내역 표시 타입: 원본의 use·refund 한정 → **전체 원장(구매·지급 포함) + Chip 필터** | 잔액과 내역이 대사 가능해짐(원본은 구매 지급분이 안 보여 잔액이 설명 안 됨). 기본 뷰 "전체", 원본 뷰는 "사용"/"환불" 칩으로 재현 |
| D8 | custom-order 견적 접수 성공 → 홈 대신 `/my-page/quote-request` 이동 | C5 플랜 D7의 예고. 접수 직후 자기 요청의 상태를 확인하는 자연스러운 랜딩 |
| D9 | 견적 상세만 custom-order 모듈(`customOrderSummary` 등)을 import — 목록은 config(tone·라벨)만 | 원본의 lazy 이유(가격·라벨 모듈 무게) 보존. 라우터가 전부 lazy여도 목록·상세 import를 분리해야 청크가 실제로 나뉨 |
| D10 | 문의 폼은 ResponsiveModal 단일 패턴(사이드 패널/시트 이원화 제거) | 하네스 폼 표준. 데스크톱 인라인 패널은 ContentLayout sidebar(요약)와 자리 충돌 |
| D11 | 허브 링크 추가: [주문과 내역] 견적 요청 내역·토큰 내역(부제 "구매 및 환불에 따른 토큰 변동을 확인합니다.") / [고객지원] 섹션 신설 — 1:1 문의 내역 | C8 플랜 §10이 예고한 행 추가. FAQ·공지는 다른 청크라 이번에도 미노출 |

## 9. 파일 계획

```text
apps/api/src/api/domains/
  tokens/{router,schemas,ledger}.py   (D1 history + D2 claim_id — 테스트 포함)
  inquiries/router.py                 (D3 PATCH·DELETE — testcontainers 인가 테스트)
packages/api-client/                  (codegen 재생성 — 서버 커밋에 동반)

apps/store/src/
  pages/my-page/
    token-history.tsx        (신규 — 잔액 sidebar + 구매·환불 + 내역. 환불 다이얼로그는 페이지 로컬)
    inquiry.tsx              (신규 — 목록 + 요약 sidebar)
    quote-request.tsx        (신규 — 목록. claims.tsx 대칭)
    quote-request-detail.tsx (신규 — 상세. claim-detail.tsx 대칭, custom-order import는 여기만)
  features/inquiry/
    ui/inquiry-form-modal.tsx (작성·수정 공용 ResponsiveModal + 상품 검색)
    model/config.ts           (카테고리 목록 · 상태 라벨/tone)
  features/quote-request/
    model/config.ts           (상태 tone · 연락 방법 라벨)
  pages/custom-order/index.tsx (수정 — D8 리다이렉트)
  pages/my-page/index.tsx      (수정 — D11 허브 행)
  app/router/index.tsx         (라우트 4건 lazy 추가)
```

- 토큰 쪽은 공유할 소비처가 없어 feature 디렉토리를 만들지 않고 페이지 로컬로 시작(C8 관례 — "feature는 최소로"). 커지면 그때 추출.

## 10. 작업 순서

1. **서버 선행(D1·D2·D3)**: tokens history 엔드포인트 + `RefundableTokenOrder.claim_id` + inquiries PATCH/DELETE, pytest(testcontainers 인가 포함) → `pnpm codegen` 같은 커밋.
2. **token-history**: 잔액 sidebar → 구매·환불 카드(reason 분기 + 신청/취소 AlertDialog) → 변동 내역 무한 스크롤 → 라우트.
3. **inquiry**: config(tone·카테고리) → InquiryFormModal(작성·수정, 상품 검색) → 목록 페이지 + 요약 sidebar + 삭제 → 라우트.
4. **quote-request**: config → 목록 → 상세(customOrderSummary 렌더, 참고 이미지 placeholder) → 라우트 → D8 리다이렉트 변경.
5. **허브 행 추가(D11)** — 링크 대상이 전부 존재하는 마지막에.
6. **검증**: `pnpm lint` → `pnpm turbo typecheck test` → `uv run pytest` → Aside 브라우저 왕복 —
   ① 비로그인 세 라우트 진입 가드 ② 토큰: 구매(DryRun Toss) → 환불 신청(안내문·잔액/목록 invalidate) → 신청 중 디자인 생성 시 `refund_pending` 차단 확인 → 취소 → 재신청, 클레임 목록/상세 정합 ③ 문의: 작성(상품 카테고리 → 검색·선택) → 수정 → 삭제 → admin API로 답변 후 수정 불가·답변 블록 표시 ④ 견적: custom-order 수량 100+ 접수 → 목록 리다이렉트 → 상세 사양·요약 확인 ⑤ 상세 청크 분리(네트워크 탭에서 custom-order 코드가 상세 청크에만) ⑥ 모바일 뷰포트(모달=BottomSheet, 무한 스크롤 센티넬).
7. `docs/CHECKLIST.md`에 C10 행 추가(현재 C9→C11로 건너뜀) + 본 문서 상태 갱신.

## 11. 이연·기록

- 상품 상세 "문의하기" → `?category=상품&product_id=` 진입 배선 — 폼은 프리필을 받도록 만들어 두고, 버튼은 상품 상세를 만지는 청크에서.
- 견적 상세의 배송지 표시 — `shipping_address_id`뿐이고 스냅샷·주소 단건 조회가 없음. 원본도 미표시. 필요해지면 QuoteOut에 주소 스냅샷 추가부터(서버 작업).
- 문의 첨부파일 — 원본에 없음(상품 연결만). 도입하려면 업로드 계약부터(범위 밖).
- FAQ·공지 허브 링크 — 해당 정적/지원 페이지 청크에서.
- 견적 '확정' → 온라인 결제 전환 — C5 백로그 그대로 유지(별도 기획).

## 12. 실행 결과

- D1~D3 API와 생성 api-client를 동기화하고, 토큰 원장 페이지네이션·환불 클레임 연결·답변 전 문의 수정/삭제를 실제 Postgres 인가 테스트로 고정했다.
- 문의 상품 선택은 서버 이름 검색으로 보강했다. 선택 전에는 목록 검색만 하고, 기존 문의의 연결 상품은 상세를 펼칠 때 단건 조회해 불필요한 요청을 줄였다.
- 견적 첨부는 `quote_request` 스테이징 이미지(최대 5장)로 분리했다. 발급 시 선언 크기·10MiB PUT 상한을 서명하고, 생성 시 소유자·중복·24시간 만료·삭제 여부와 실제 GCS 객체의 MIME·크기를 대조한 뒤 견적·디자인 주문에 같은 이미지 행을 재연결한다.
- 네 라우트를 ProtectedRoute 아래 lazy 청크로 추가하고, 견적 상세의 custom-order 의존성은 상세 청크에만 남겼다. custom-order 접수 성공은 견적 목록 캐시를 무효화한 뒤 목록으로 이동한다.
- Aside로 비로그인 가드, 토큰 환불 신청→디자인 생성 차단→취소, 문의 작성·수정·삭제·답변 완료, 견적 접수→목록→상세, 390px BottomSheet·토큰 내역 자동 추가 로딩을 확인했다.
- Python 전체 테스트 444개·ruff·pyright와 store 99개/shared 45개 테스트·typecheck·build, 하네스 검사, codegen 재생성 및 diff 검사를 완료했다.
- 루트 `pnpm lint`는 변경 파일이 아닌 git 비추적 로컬 설정 `.claude/settings.local.json`의 기존 배열 포맷 1건만 보고한다. C10 변경 파일 대상 Biome 검사와 하네스 검사는 통과했다.
