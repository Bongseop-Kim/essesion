# store 후기(리뷰) + 문의 Q&A + 정보/문의/후기 섹션 구현 플랜

> 후기 기능을 신규 구축한다 — essesion·YeongSeon 모두 리뷰는 **미구현**(홈의 하드코딩 후기 3개가 전부)이므로 원본 이식 대상이 없는 순수 신규 설계다. 문의는 **기존 1:1 문의 인프라를 공개 Q&A로 확장**한다(공개/비공개 선택 + 공개 목록).
> 범위: ① 4개 서비스(스토어 판매·수선·주문 제작·샘플 제작) 전부에 후기 작성·노출 ② 주문 제작·샘플 제작 페이지에 수선(`ReformServiceGuide`)급 서비스 설명 섹션 신설 ③ 4개 서비스 전부에 문의 Q&A — 작성 시 공개/비공개 선택, 공개 문의는 비회원 포함 누구나 열람('샘플제작' 카테고리 신설 포함) ④ 상세 하단(`detail`)에 **정보/문의/후기 섹션을 한 스크롤로 배치하고 sticky 앵커 내비게이션 제공** ⑤ admin 후기 관리(목록+삭제).
> **상태: 완료 (2026-07-16)**
> 원본 참고(복사 금지): YeongSeon에 리뷰 기능은 없음 — `apps/store/src/shared/lib/product-jsonld.ts:56-59`에 "리뷰 미구현" 주석만 존재(JSON-LD 실데이터 연동은 이연, §15). 문의 원본 명세는 상품 상세 "문의하기" 버튼 → `/my-page/inquiry?category=상품&productId=` 이동이 전부(`YeongSeon/apps/store/src/pages/shop/detail.tsx:217-225`) — 공개 Q&A는 원본에 없는 **신규 요구**다.

## 1. 배경 — 실행 전 알아야 할 현재 상태

새 세션에서 실행할 것을 전제로 확인된 사실을 앵커와 함께 적는다 (라인 번호는 2026-07-16 기준, 어긋나면 심볼로 검색):

- **4개 서비스는 단일 `Order` 테이블로 수렴한다** — `db/src/db/models/commerce.py:207` 부근, `order_type` CHECK = `'sale','custom','repair','token','sample'`. 대량(100개↑) 주문 제작만 별도 `QuoteRequest`(결제 없는 견적 협의)로 빠지며 **후기 대상이 아니다**.
- **리뷰 관련 기존 코드 없음**: DB 모델·API 라우터·프론트 페이지 어디에도 없다. 홈의 `apps/store/src/features/home/reviews.tsx`는 정적 마케팅 배열(범위 밖, §15).
- **1:1 문의 인프라는 완성돼 있다**: `Inquiry` 모델(`commerce.py:373`, category CHECK = `'일반','상품','수선','주문제작'`, 선택적 `product_id`) + 고객 CRUD 라우터(`apps/api/src/api/domains/inquiries/router.py`) + admin 목록·답변(`domains/admin/inquiries.py`) + store `features/inquiry`의 `InquiryFormModal`(이미 `prefill: {category, productId}` prop 보유). **없는 것**: 상품/서비스 페이지의 진입점(현재 문의 진입은 헤더 nav와 마이페이지뿐 — `app-layout.tsx:40`), 공개/비공개 구분 컬럼과 공개 목록 API, `'샘플제작'` 카테고리.
- **기존 문의 데이터는 비공개 전제로 작성됐다** — 공개 Q&A 도입 시 기존 행을 공개로 소급하면 안 된다(주문번호·연락처 등 개인정보 포함 가능). 백필은 전부 비공개(§2b).
- **"완료" 상태값**: `apps/store/src/features/orders/model/display.ts`의 `POSITIVE_STATUSES = {"완료","배송완료","제작완료","수선완료"}` — 후기 작성 자격의 상태 기준.
- **상세 하단의 하우스 패턴**: `apps/store/src/shared/ui/content-layout.tsx`의 `detail` prop(본문 하단 Divider + 상세 블록). 스토어 상세는 `detail={<ProductDetail/>}`(`pages/shop/detail.tsx:246`), 수선은 `detail={<ReformServiceGuide/>}`(`pages/reform/index.tsx:369`). **주문 제작·샘플 제작 페이지는 `detail`을 넘기지 않아** 순수 설정기 + 한 줄 안내뿐이다.
- **최종 상세 탐색 계약**: 최초 계획의 lazy `Tabs` 대신 사용자 요청에 따라 `StickySectionNav`를 사용한다. 정보·문의·후기는 모두 같은 문서 흐름에 렌더하고, 상단 내비게이션은 헤더 아래에 고정된 네이티브 앵커로 각 섹션에 이동한다.
- **버튼 노출 원칙(기존 확정)**: 주문 상세의 고객 액션은 전부 서버 `customer_actions` 위임 — 프론트는 자격을 재계산하지 않는다 (`docs/plans/store-order-claim.md` D6, `apps/store/src/pages/order/detail.tsx:102` `customerActions`).
- **필독**: UI 작업 전 `packages/shared/AGENTS.md`(디자인 시스템 하네스 — 규칙 0: shared 컴포넌트 → 프리미티브+토큰 → 표현 불가 시 멈추고 추가 제안). 브라우저 검증은 `.claude/skills/aside-browser/SKILL.md`.

## 2. 데이터 모델

### 2a. `reviews` 테이블 (신규)

`db/src/db/models/commerce.py`에 추가. 선언 스타일은 `ProductLike`(line 99)·`Inquiry`(line 373) 미러: `TimestampMixin`, `uuid_pk()`, name 있는 CheckConstraint, admin 목록 인덱스.

| 컬럼 | 타입/제약 | 비고 |
|---|---|---|
| `id` | `uuid_pk()` | |
| `order_id` | uuid FK `orders.id` `ondelete="CASCADE"`, not null | 작성 자격의 원천 |
| `order_item_id` | uuid FK `order_items.id` `ondelete="CASCADE"`, **nullable** | sale은 상품(아이템)별 후기 → not null, repair/custom/sample은 주문(서비스) 단위 → null |
| `user_id` | uuid FK `users.id` `ondelete="SET NULL"`, nullable, index | Inquiry와 동일 — 탈퇴해도 후기는 보존 |
| `order_type` | text + CHECK `IN ('sale','repair','custom','sample')` | **비정규화** — 서비스별 공개 목록 쿼리가 orders 조인 없이 인덱스를 타게. 생성 시 주문에서 복사. `token` 제외 |
| `product_id` | int FK `products.id` `ondelete="SET NULL"`, nullable, index | sale 전용 비정규화(order_item에서 복사) — 상품 상세 목록 쿼리용 |
| `rating` | int + CHECK `BETWEEN 1 AND 5` | |
| `content` | text + CHECK `char_length BETWEEN 1 AND 1000` | |

- **중복 방지**: `UniqueConstraint("order_id", "order_item_id", postgresql_nulls_not_distinct=True)` — PG17이므로 NULLS NOT DISTINCT 한 줄로 서비스 후기(item null) 주문당 1건 + sale 아이템당 1건을 동시에 강제. (미지원 판명 시 부분 유니크 인덱스 2개로 대체.)
- 목록 인덱스: `Index("ix_reviews_public_list", "order_type", "created_at", "id")` + product_id index. admin 목록은 created_at 정렬이므로 위 인덱스 재사용.
- 사진 후기는 **이연**(§15) — 이미지 컬럼을 미리 넣지 않는다.
- 마이그레이션: `uv run alembic -c db/alembic.ini revision --autogenerate -m "add reviews"` 생성 후 검수, **모델과 같은 커밋**. CheckConstraint name 필수, PG enum 금지(text+CHECK) — `db/README.md` 규칙.

### 2b. `inquiries` 변경 — `is_secret` 컬럼 + category CHECK 확장

- **`is_secret: Mapped[bool]`** 추가, `server_default=text("true")` not null — server_default가 곧 백필: **기존 행은 전부 비공개**가 된다(§1의 소급 공개 금지). 새 문의의 기본값은 API 스키마가 결정(§3b — 공개 기본). DB 기본과 API 기본이 다른 것은 의도된 비대칭: DB 기본은 마이그레이션 백필 전용, API는 항상 명시값을 보낸다.
- `commerce.py:392`의 category CheckConstraint를 `IN ('일반', '상품', '수선', '주문제작', '샘플제작')`으로 확장.
- 공개 목록 인덱스: `Index("ix_inquiries_public_list", "category", "created_at", "id")` — product_id는 기존 FK 인덱스 활용(없으면 추가).
- 컬럼 추가는 autogenerate가 잡지만 **CHECK 본문 변경은 감지하지 못한다** — 한 리비전에서 autogenerate 후 `op.drop_constraint` → `op.create_check_constraint`를 수동 보강, `alembic check`로 드리프트 0 확인. 모델 변경과 같은 커밋.
- reviews 리비전과 트랙이 독립이므로 **별도 리비전·별도 커밋**(§13 작업 순서).

## 3. API 설계

### 3a. reviews (신규 도메인)

`apps/api/src/api/domains/reviews/{router,service,schemas}.py` 3분할(reform/quotes식). 라우터 등록은 `apps/api/src/api/main.py`의 `_include_routers`(line 319~)에 import 1줄 + include 1줄. dependency는 `api/deps.py`의 `CurrentUser`/`OptionalUser`/`ensure_owner`/`AdminUser` 재사용.

| 용도 | 엔드포인트 | 인가 | 비고 |
|---|---|---|---|
| 후기 작성 | `POST /reviews` | CurrentUser | body: `order_id, order_item_id?, rating, content`. 가드: 주문 소유자 + 상태 ∈ POSITIVE(§1) + sale이면 order_item_id 필수·해당 주문 소속, 서비스면 order_item_id 금지. 중복·자격 미달 409 |
| 공개 목록 | `GET /reviews?product_id=` 또는 `?order_type=repair\|custom\|sample` | 공개 | 둘 중 정확히 하나 필수(422). 응답 envelope: `{items, total, avg_rating, limit, offset}` — 별점 요약을 별도 엔드포인트 없이 동봉. limit 기본 20/최대 100, created_at desc + id 타이브레이커 |
| 후기 단건 조회 | `GET /reviews/{id}` | 공개 | 주문 상세의 "작성한 후기 보기" 모달에서 동일한 공개 응답 모델을 재사용 |
| 수정 | `PATCH /reviews/{id}` | owner | `ensure_owner`. rating/content만 |
| 삭제 | `DELETE /reviews/{id}` | owner | |
| admin 목록 | `GET /admin/reviews` | AdminUser | `admin/inquiries.py`의 `Page[T]`+`_page/_filters/_sort` 패턴 미러(`apps/api/src/api/domains/admin/inquiries.py`). 필터: order_type, rating |
| admin 삭제 | `DELETE /admin/reviews/{id}` | AdminUser | |

- **`ReviewOut`**: `id, rating, content, created_at, order_type, product_id, author_name` — author_name은 **서버에서 마스킹**(예: `김**`, user 삭제 시 `탈퇴 회원`). user_id는 공개 응답에 노출하지 않는다.
- **작성 자격 신호는 서버가 내린다**(하우스 원칙, §1):
  - `orders/status_machine.py`의 `customer_actions`에 **`write_review`** 추가 — 상태 ∈ POSITIVE이고 미작성 후기 대상(서비스 주문 자체 또는 sale 아이템 중 1개 이상)이 남아 있을 때.
  - `orders/schemas.py`: `OrderItemOut`에 `review_id: uuid | None`, `OrderOut`(상세 채움)에 `review_id: uuid | None` 추가 — 프론트가 아이템별 작성/작성됨을 구분(배송지 D9와 같은 optional-필드 방식).
- **API 스펙 변경 커밋에 `pnpm codegen` 생성물(`packages/api-client`) 동봉** — CI codegen-drift가 검사.

### 3b. inquiries 확장 — 공개 목록 + is_secret + 카테고리

`apps/api/src/api/domains/inquiries/router.py` 확장(도메인 신설 없음):

| 용도 | 엔드포인트 | 인가 | 비고 |
|---|---|---|---|
| 공개 Q&A 목록 | `GET /inquiries/public?product_id=` 또는 `?category=수선\|주문제작\|샘플제작` | 공개(`OptionalUser`) | 둘 중 정확히 하나 필수(422) — reviews 공개 목록(§3a) 미러. envelope `{items, total, limit, offset}`, limit 기본 20/최대 100, created_at desc + id 타이브레이커. **`/inquiries/{inquiry_id}`보다 먼저 등록**(경로 충돌 주의) |

- **`PublicInquiryOut`**: `id, category, title, content, status, answer, answer_date, created_at, author_name(마스킹 — reviews와 동일 헬퍼, §3a), is_secret, is_mine`. **비밀글 마스킹은 서버에서**: `is_secret=true`이고 요청자가 작성자가 아니면 `title="비밀글입니다"`, `content=None`, `answer=None`. 작성자 본인(`OptionalUser` 일치)에게는 원문 그대로 + `is_mine=true`. 비밀글도 행 자체는 노출(날짜·카테고리·답변 여부만 드러남) — Q&A 활동량이 보이는 표준 커머스 패턴.
- **`InquiryCreateRequest`/`InquiryUpdateRequest`에 `is_secret: bool = False` 추가**(공개 기본, D15) — 수정은 기존 규칙대로 답변대기 상태에서만. `InquiryOut`(내 문의 조회)에도 `is_secret` 노출.
- `router.py:18`의 `InquiryCategory` Literal + `admin/inquiry_schemas.py:10`의 `InquiryCategoryFilter` Literal에 `"샘플제작"` 추가.
- admin 목록/상세 응답에 `is_secret` 추가(뱃지 표시용) — admin은 비밀글도 원문 열람(기존과 동일, 답변 주체).
- OpenAPI 스펙 변경이므로 `pnpm codegen` 동봉.
- `apps/api/tests/test_inquiries.py` 추가 케이스: ① 비회원 공개 목록 200 + 비밀글 마스킹 확인 ② 작성자 본인에게 비밀글 언마스킹 + `is_mine` ③ `product_id`/`category` 파라미터 검증 422 ④ 샘플제작 카테고리 생성(admin 필터는 `test_admin_quotes_inquiries.py` 기존 매트릭스에 값 추가 수준).

## 4. store 프론트 — 후기 작성 플로우

신규 feature `apps/store/src/features/reviews/{model,ui}/ + index.ts` (FSD, `features/reform` 구조 미러).

- **진입점은 주문 상세**(`pages/order/detail.tsx`)뿐 — 공개 노출 페이지에는 작성 버튼을 두지 않는다(자격이 주문에 귀속되므로, D4).
  - 서비스 주문(repair/custom/sample): `customerActions.includes("write_review")` 시 구매확정 블록(line 288~309) 근처에 "후기 작성" 버튼. 작성 완료 후엔 `order.review_id`로 "작성한 후기 보기".
  - sale 주문: `order.items.map`(line 316~) 아이템 카드에 per-item 버튼 — `item.review_id` null이면 "후기 작성", 있으면 "작성한 후기 보기".
- **`ReviewFormModal`** (`features/reviews/ui/review-form-modal.tsx`): `ResponsiveModal`(모바일 BottomSheet↔PC Modal — 폼 기본 패턴). 필드는 별점(`Rating` 입력 모드, §6) + `TextAreaField`(1,000자). 제출 = `createReviewMutation` → 해당 주문 `getOrderQueryKey`·공개 목록 쿼리 invalidate → `snackbar()` → 닫기. "작성한 후기 보기" 모드에서는 기존 후기 표시 + 수정/삭제(삭제는 `AlertDialog` 확인).
- api-client 훅은 코드젠 산출물 사용: `createReviewMutation`/`listReviewsOptions` 등 (`@essesion/api-client/query`) — 서버 먼저, 코드젠 후 배선.

## 5. store 프론트 — 후기 노출 컴포넌트

**`ReviewListSection`** (`features/reviews/ui/review-list-section.tsx`) 하나로 4곳을 커버: props `{ productId?: number; orderType?: "repair"|"custom"|"sample" }`. 헤더에 `Rating`(표시 모드) + 평균/개수, 목록은 작성자(마스킹)·별점·내용·날짜 카드, `total > limit`이면 "더보기"(offset 증가). 로딩 `Skeleton` / 에러 `ContentPlaceholder`.

- **0건이면 후기 섹션에 `ContentPlaceholder`**("아직 등록된 후기가 없습니다" 수준) — 섹션을 숨기지 않고 빈 상태를 명시한다(D5 개정). 페이지 배선은 §9의 표.

## 6. shared — `Rating` 컴포넌트 신설

별점 UI가 `packages/shared`에 없다(조사 확인). store(입력+표시)·admin(표시) 2개 앱이 쓰므로 승격 기준 충족 — `packages/shared/src/components/rating.tsx` + `src/index.ts` barrel export (AGENTS.md 규칙 7).

- 표시 모드(읽기 전용, 0.5 단위 반올림 표시)와 입력 모드(1~5 정수 클릭/키보드 선택, `value/onChange`) — prop 하나로 분기.
- 토큰만 사용(별 채움 `fg.brand` 계열, 빈 별 `fg.subtle` 계열 — 하네스 위반 금지). 별 아이콘 에셋은 앱 소유 원칙이지만 Rating은 shared 내부 구현이므로 인라인 svg로 자체 보유.
- 임의 값 우회로 만들지 말 것 — 하네스가 막으면 토큰 추가를 먼저 제안(규칙 0).

## 7. 주문 제작·샘플 제작 서비스 설명 섹션 (정보 섹션 콘텐츠)

`ReformServiceGuide`(`apps/store/src/features/reform/ui/reform-service-guide.tsx`)를 본보기로 정적 콘텐츠 컴포넌트 2개 신설. 페이지 연결은 §9의 정보 섹션으로. **후기·문의와 독립적인 작업**이라 먼저/병렬 진행 가능.

- `features/custom-order/ui/custom-order-service-guide.tsx`.
  담을 내용(기존 페이지 안내 문구·사이드바 Callout·서버 규칙에서 도출): ① 진행 단계(옵션 선택 → 결제/견적 → 제작 → 발송) ② **소량(4~99개) 즉시 결제 vs 대량(100개↑) 견적 협의**(요청→견적발송→협의중→확정, 알림톡 안내) 분기 설명 ③ 예상 제작 기간 ④ 주문 제작 특성상 취소·환불 제약 ⑤ AI 디자인(`DesignPicker`) 연동 안내.
- `features/sample-order/ui/sample-order-service-guide.tsx`.
  담을 내용: ① 샘플 유형 3종(원단/봉제/원단+봉제) 설명 ② 진행 단계·기간 ③ **샘플 결제 → 본주문 할인 쿠폰** 흐름(`sample_discount` pricing) ④ 취소·환불 제약.
- 이미지·영상 에셋 없이 텍스트+단계 구성으로 시작(수선 가이드의 영상·비교 이미지는 에셋이 있어 가능했던 것). 문구 초안은 구현자가 기존 안내 문구와 YeongSeon 원본 명세에서 도출하고, **확정 카피는 PR 리뷰에서 조정** — 문구 때문에 구현을 멈추지 말 것.

## 8. store 프론트 — 문의 Q&A (문의 섹션 콘텐츠)

**공개 Q&A 게시판이다**(D12) — 공개 문의는 비회원 포함 누구나 열람, 작성 시 비공개 선택 가능(D15). 작성·수정·admin 답변 플로우는 기존 1:1 문의 인프라를 그대로 쓴다.

**`InquirySection`** (`features/inquiry/ui/inquiry-section.tsx`, 신규): props `{ category: InquiryCategory; productId?: number }`.

- **공개 Q&A 목록**: `listPublicInquiriesOptions`(§3b, 코드젠 산출물)를 `Accordion`(shared)으로 — 접힌 행은 제목·상태 `Badge`(`inquiryStatusTone` 재사용)·작성자(마스킹)·날짜, 펼치면 문의 내용 + 답변(답변완료 시). **비밀글 행**: 잠금 아이콘 + "비밀글입니다", 펼침 불가 — 단 `is_mine=true`면 원문 펼침 가능 + "내 문의" 뱃지(마스킹은 서버 몫이라 프론트는 받은 값을 그대로 그린다). `total > limit`이면 "더보기"(offset 증가). 로딩 `Skeleton` / 에러 `ContentPlaceholder` / 0건 `ContentPlaceholder`("첫 문의를 남겨 보세요" 수준) — 어느 상태든 문의하기 버튼은 유지.
- **작성 버튼**: "문의하기" `ActionButton` — `useAuthGuard().requireAuth`(store AGENTS.md 인증 규칙) → `InquiryFormModal`을 `prefill={{ category, productId: productId ?? null }}`로 오픈(prefill prop 기존 보유, §1). 등록 성공 시 공개 목록 쿼리도 invalidate.
- **`InquiryFormModal`에 비공개 `Checkbox` 1개 추가**: "비밀글로 문의하기 (작성자와 관리자만 볼 수 있어요)" — 기본 해제(공개, D15). `features/inquiry/model/form.ts` 스키마·`inquiryRequestFromForm`에 `is_secret` 배선. 마이페이지 수정 플로우에서도 동일하게 동작(답변대기 상태 한정 — 기존 규칙).
- 항목의 수정·삭제는 여기서 재구현하지 않는다 — 마이페이지 문의 내역 몫(기존 그대로).
- `features/inquiry/model/config.ts:6`의 `INQUIRY_CATEGORY_VALUES`에 `"샘플제작"` 추가(타입은 codegen이 확장).
- admin: `apps/admin/src/pages/inquiries/list.tsx:28`의 `INQUIRY_CATEGORIES` 배열에 `"샘플제작"` 추가 + 목록/상세에 비밀글 `Badge`(응답의 `is_secret`) — admin은 원문 열람(답변 주체).

## 9. 정보/문의/후기 sticky 섹션 내비게이션 (4곳 배선)

상세 하단의 가이드+문의+후기를 `detail` prop 안의 한 문서 흐름으로 연속 배치한다. `apps/store/src/shared/ui/sticky-section-nav.tsx`가 헤더 바로 아래에 고정되는 3등분 앵커 내비게이션과 섹션 간격·구분선을 공통 소유한다.

- 각 페이지는 고유 섹션 ID와 콘텐츠 노드만 전달한다. 정보 내용과 조회 파라미터의 조합은 계속 페이지 층이 소유한다.
- 링크는 `href="#..."` 네이티브 앵커이며 클릭한 링크에 `aria-current="location"`을 적용한다. 섹션 `scroll-margin-top`은 sticky Header+내비게이션 높이를 토큰 계산으로 보정한다.
- 정보·문의·후기는 모두 즉시 렌더하므로 한 번의 연속 스크롤로 읽을 수 있다. 공개 문의·후기 조회도 페이지 진입 시 함께 시작한다.
- 라벨은 고정 텍스트 `정보 / 문의 / 후기`, 내비게이션은 모바일·데스크톱 모두 3등분이다.

| 페이지 | `detail` 앵커 | 정보 섹션 | 문의 `InquirySection` | 후기 `ReviewListSection` |
|---|---|---|---|---|
| 상품 상세 | `pages/shop/detail.tsx:246` | 기존 `ProductDetail`(설명+상세 이미지) 그대로 | `category="상품" productId={id}` | `productId={id}` |
| 수선 | `pages/reform/index.tsx:369` | 기존 `ReformServiceGuide` | `category="수선"` | `orderType="repair"` |
| 주문 제작 | `pages/custom-order/index.tsx:414` `ContentLayout`에 `detail` 신설 | `CustomOrderServiceGuide`(§7) | `category="주문제작"` | `orderType="custom"` |
| 샘플 제작 | `pages/sample-order/index.tsx:120` `ContentLayout`에 `detail` 신설 | `SampleOrderServiceGuide`(§7) | `category="샘플제작"` | `orderType="sample"` |

## 10. admin — 후기 관리 (목록 + 삭제)

- `apps/api/src/api/domains/admin/reviews.py` — `admin/inquiries.py` 미러(§3a 표), main.py에 `admin_reviews_router` 등록.
- `apps/admin/src/pages/reviews/list.tsx` — `PaginatedAdminTableCard`(`widgets/admin-table/`) + `useSearchParams` URL 동기화 + `CompactFilterToolbar`(order_type·rating 필터). 컬럼: 작성일·유형·별점(`Rating` 표시)·내용(truncate)·작성자. 행 액션 "삭제" = `AlertDialog` 확인 → DELETE → invalidate. **상세 페이지는 만들지 않는다**(내용 전문은 행 확장 또는 목록 셀 tooltip 수준으로 충분 — 부족하면 후속).
- 라우터 등록: `apps/admin/src/app/router/`.

## 11. 결정 사항

| ID | 결정 | 근거 |
|---|---|---|
| D1 | 후기는 order 기반 단일 테이블 — 4개 서비스 공통, sale만 아이템 단위 | 4종이 이미 단일 Order로 수렴. 타입별 테이블/분기는 추가 비용만 발생 |
| D2 | 대량 주문 제작(`QuoteRequest`)은 후기 대상 제외 | 결제·주문 레코드가 없는 협의 플로우. Order로 전환된 건은 자연히 포함 |
| D3 | 작성 자격 = 서버 `customer_actions`의 `write_review` + `review_id` 필드 | 프론트 자격 재계산 금지(기존 D6 원칙). 상태 기준은 POSITIVE 4종 |
| D4 | 후기 작성 진입은 주문 상세만, 공개 페이지에는 작성 버튼 없음 | 자격이 주문에 귀속. 노출 페이지는 읽기 전용으로 단순 유지 |
| D5 | 후기 섹션은 상시 노출, 0건이면 `ContentPlaceholder` | 한 스크롤 구조에서 섹션을 숨기지 않고 로딩·빈·에러 상태를 명시 |
| D6 | `order_type`·`product_id` 비정규화 + NULLS NOT DISTINCT 유니크 | 공개 목록이 orders 조인 없이 인덱스 직행. 중복 방지 제약 1개로 두 규칙 커버 |
| D7 | 평균 별점은 목록 응답에 동봉(집계 쿼리) — 카운터 캐시 없음 | 데이터 소량. 비정규화 카운터는 측정 후에 |
| D8 | content 필수 1~1,000자, rating 1~5 정수, 수정·삭제 제한 없음(owner) | 별점-only 후기 허용은 수요 확인 후. 기간 제한은 요구 없음 |
| D9 | 사진 후기 이연 | GCS 업로드 인프라(reform upload)가 있어 추후 추가 용이 — 초기 스키마에 선반영하지 않음 |
| D10 | admin은 목록+삭제만(상세 페이지 없음), 답변/노출숨김 기능 없음 | 운영 요구 최소치. 숨김(soft-hide)은 필요해지면 status 컬럼 추가로 |
| D11 | 서비스 설명 섹션은 텍스트+단계 구성, 에셋 없이 시작 | custom/sample용 이미지·영상 에셋 부재. 카피는 PR에서 확정 |
| D12 | 문의는 기존 Inquiry 테이블·플로우를 공개 Q&A로 확장 — 별도 Q&A 테이블/도메인 신설 없음 | 작성·수정·admin 답변 인프라 완비. 추가분은 `is_secret` 컬럼 + 공개 목록 엔드포인트 1개 + 진입 컴포넌트 1개. 공개 조회는 마스킹 응답 한정이라 "그 외 리소스는 소유자만" 인가 원칙과 충돌 없음(reviews 공개 목록과 같은 층위) |
| D13 | 상세 하단은 정보/문의/후기를 연속 렌더하고 sticky 앵커 내비게이션으로 이동(4곳 공통) | 사용자 요청으로 선택 패널 방식 대신 한 스크롤 읽기와 상단 고정 이동을 채택. 반복되는 위치·간격·접근성 계약은 store-local 공용 조합이 소유 |
| D14 | `'샘플제작'` 문의 카테고리 신설 | 문의 유형을 서비스 4종과 정합. CHECK+Literal 2곳+배열 2곳 — 한 줄씩 |
| D15 | 공개/비공개는 작성자 선택(체크박스), **새 문의 기본 공개·기존 행 백필은 전부 비공개**. 비밀글은 목록에 마스킹 행으로 노출(제목·내용·답변 숨김), 작성자 본인·admin만 원문 | 기존 데이터는 비공개 전제로 작성 — 소급 공개는 프라이버시 위반. 새 문의 공개 기본은 Q&A 게시판 취지(커머스 관례). 마스킹 행 노출은 활동량 신호 — 드러나는 것은 카테고리·날짜·답변 여부뿐 |

## 12. 파일 계획

```text
db/src/db/models/commerce.py               (Review 모델 §2a + Inquiry is_secret·category CHECK §2b)
db/migrations/versions/…                   (alembic revision 2개 — 각 모델 변경과 같은 커밋)

apps/api/src/api/domains/
  reviews/{router,service,schemas}.py      (신규 — §3a)
  admin/reviews.py                         (신규 — §10)
  inquiries/router.py                      (공개 목록 + is_secret + 샘플제작 — §3b)
  admin/inquiry_schemas.py                 (InquiryCategoryFilter에 샘플제작, is_secret 노출 — §3b)
  orders/status_machine.py                 (write_review 액션 — D3)
  orders/schemas.py                        (OrderItemOut.review_id·OrderOut.review_id)
apps/api/src/api/main.py                   (_include_routers에 reviews·admin_reviews)
apps/api/tests/
  authz.py                                 (owner 케이스: PATCH/DELETE /reviews — admin 케이스: admin 목록/삭제)
  test_reviews.py                          (신규 — 자격 가드·중복 409·공개 목록·마스킹)
  test_inquiries.py                        (공개 목록·비밀글 마스킹·샘플제작 케이스 — §3b)

packages/shared/src/components/rating.tsx  (신규 — §6) + src/index.ts
packages/api-client/                       (pnpm codegen 생성물 — API 커밋마다 동봉)

apps/store/src/
  features/reviews/
    ui/review-form-modal.tsx               (ResponsiveModal — §4)
    ui/review-list-section.tsx             (공용 노출 섹션 — §5)
    index.ts
  features/inquiry/
    ui/inquiry-section.tsx                 (신규 — §8, 공개 Q&A 목록+작성 진입)
    ui/inquiry-form-modal.tsx              (비밀글 Checkbox 추가 — §8)
    model/form.ts                          (is_secret 배선 — §8)
    model/config.ts                        (INQUIRY_CATEGORY_VALUES에 샘플제작)
  features/custom-order/ui/custom-order-service-guide.tsx   (신규 — §7)
  features/sample-order/ui/sample-order-service-guide.tsx   (신규 — §7)
  shared/ui/sticky-section-nav.tsx          (sticky 앵커 내비게이션 + 연속 섹션 — §9)
  shared/ui/sticky-section-nav.test.tsx     (동시 렌더·앵커·현재 위치 회귀 테스트)
  pages/order/detail.tsx                   (후기 작성/보기 버튼 — §4)
  pages/shop/detail.tsx                    (detail 연속 섹션 배선 — §9)
  pages/reform/index.tsx                   (detail 연속 섹션 배선 — §9)
  pages/custom-order/index.tsx             (detail 신설: 연속 섹션 — §9)
  pages/sample-order/index.tsx             (detail 신설: 연속 섹션 — §9)

apps/admin/src/pages/reviews/list.tsx      (신규 — §10) + app/router/ 등록
apps/admin/src/pages/inquiries/{list,detail}.tsx  (샘플제작 필터 + 비밀글 Badge — §8)
docs/CHECKLIST.md                          (api 도메인·프론트 항목 추가)
```

## 13. 작업 순서

세 트랙(가이드 §7 / 문의 §2b·3b·8 / 후기 §2a·3a·4·5·6·10)은 상호 독립 — 섹션 내비게이션 배선(§9)만 셋을 모은다.

1. **서비스 설명 섹션 2건(§7)** — 무의존, 별도 커밋으로 먼저 처리 가능.
2. **문의 트랙**: is_secret+category 리비전(§2b) → 공개 목록 엔드포인트·is_secret 스키마·Literal 2곳 + `test_inquiries.py` 보강 + `pnpm codegen` **같은 커밋**(§3b) → store 폼 is_secret 배선·config.ts·admin 필터/뱃지 → `InquirySection`(§8).
3. **후기 DB**: Review 모델 + alembic revision(같은 커밋) → 로컬 `upgrade head` + `alembic check` 드리프트 0.
4. **후기 서버**: reviews 도메인 + status_machine `write_review` + orders 스키마 보강 + admin/reviews → `authz.py` 행 추가 + `test_reviews.py`(testcontainers, mock 금지) → `pnpm codegen` **같은 커밋**.
5. **shared `Rating`** 컴포넌트.
6. **store 후기 작성 플로우(§4)**: ReviewFormModal + 주문 상세 버튼 배선.
7. **sticky 섹션 내비게이션 + 노출 배선(§9)**: `ReviewListSection`(§5) 완성 후 4개 페이지 detail에 정보/문의/후기를 연속 배치하고 앵커 내비게이션으로 조립.
8. **admin 후기 관리(§10)**.
9. **검증(§14)** → `docs/CHECKLIST.md` 갱신 → 본 문서 상태 라인 갱신.

## 14. 검증

- `pnpm lint` · `pnpm turbo build typecheck test` · `uv run ruff check .` · `uv run ruff format --check .` · `uv run pyright` · `uv run pytest` 전부 통과.
- API: test_reviews.py에서 ① 완료 전 주문 작성 409 ② sale에 order_item_id 누락/타주문 아이템 422·409 ③ 중복 작성 409 ④ 익명 401·타인 403·owner/admin 통과(authz 매트릭스) ⑤ 공개 목록의 avg_rating·author_name 마스킹. test_inquiries.py에 공개 목록(비회원 200·비밀글 마스킹·본인 언마스킹·파라미터 422)·샘플제작 케이스(§3b).
- Aside 브라우저 왕복(시드 데이터 기준):
  - 후기: ① 배송완료 sale 주문 상세 → 아이템 "후기 작성" → 모달 제출 → 버튼이 "작성한 후기 보기"로 전환 → 상품 상세 후기 섹션에 후기·평균 별점 표시 ② 수선완료 주문 → 서비스 후기 작성 → `/reform` 후기 섹션 노출 ③ 후기 0건 페이지에서 `ContentPlaceholder` ④ 후기 수정·삭제(AlertDialog) 왕복 ⑤ admin 목록 필터·삭제 → store 반영.
  - 문의: ⑥ **비로그인**으로 상품 상세 문의 섹션 → 공개 문의 목록·답변 열람 가능, 비밀글은 "비밀글입니다"로 펼침 불가, "문의하기"는 로그인 유도 AlertDialog ⑦ 로그인 후 모달에 카테고리 "상품"+해당 상품 프리필 확인 → 공개로 등록 → 문의 섹션 목록·마이페이지 문의 내역 반영 ⑧ 비밀글 체크로 등록 → 본인에겐 원문+"내 문의" 뱃지, 타 계정·비로그인에겐 마스킹 행 ⑨ 샘플 제작 문의 섹션에서 "샘플제작" 카테고리 등록 → admin 문의 목록 카테고리 필터로 조회 + 비밀글 Badge·원문 열람 → 답변 등록 → store 문의 섹션에 답변 노출.
  - 섹션·레이아웃: ⑩ 4개 페이지에서 정보·문의·후기가 한 스크롤에 동시 렌더 ⑪ sticky 내비게이션 클릭 시 섹션 앵커 이동, Header 아래 고정, `aria-current` 갱신 ⑫ custom/sample 정보 가이드 렌더 ⑬ ReviewFormModal 반응형 동작 + 콘솔 오류 0.
- E2E(Playwright, `e2e/`)는 체크포인트 원칙에 따라 머지 직전 1회 — `store-money-path.spec.ts` 확장 여부는 그때 판단(필수 아님).

## 15. 이연·기록

- ~~**사진 후기**(D9)~~ — **구현 완료 (2026-07-18)**: `Review.photos` JSONB(`[{object_key, upload_id}]` 순서 보존) + 공개 assets 버킷(상품 이미지 패턴 — 후기는 공개 콘텐츠라 서명 read URL 부적합). `/reviews/photo-uploads`(+complete)로 스테이징(24h TTL) 후 작성/수정 시 최대 5장 링크, 제외·삭제분은 만료→cleanup 배치가 assets 버킷에서 삭제(`batch/router.py` 버킷 분기). store 폼 `ReviewPhotoField`(즉시 업로드)·조회/목록 썸네일, admin 목록 사진 컬럼.
- **섹션 내비게이션 개수 뱃지**(후기 N·문의 N) — 각 조회 결과를 내비게이션까지 끌어올릴 요구가 생기면 추가. 현재 해시 앵커가 딥링크를 제공한다.
- **Q&A 고도화** — 공개↔비공개 답변 후 전환 허용, 문의 검색/카테고리 내 필터, 답변 알림(알림톡) — 수요 확인 시.
- **마이페이지 "내 후기" 목록** — 진입·수정이 주문 상세로 충분한 동안 보류.
- **홈 정적 후기(`features/home/reviews.tsx`) 실데이터 교체** — 후기가 쌓인 뒤 별도 청크.
- **상품 JSON-LD aggregateRating**(`shared/lib/product-jsonld.ts:56-59` 주석 + 회귀 테스트 존재) — 실데이터 연동 시 테스트도 갱신 필요.
- **후기 숨김/신고 등 모더레이션 고도화**(D10) — admin 삭제로 시작, 필요 시 status 컬럼.
- 별점-only(내용 생략) 허용, 후기 이벤트(작성 시 쿠폰/토큰 보상) — 기획 확정 시.
