# store Home 재구현 플랜

> YeongSeon `apps/store/src/pages/home` + `features/home/EsLanding`을 essesion store로 재작성.
> 기능 명세(무엇을 보여주는가)는 보존, 구현은 전부 새로 — **디자인 시스템 하네스(`packages/shared/AGENTS.md`)로 번역**한다.
> 원본은 raw `<div>` + 임의 Tailwind 값(hex 색·`text-[18px]`·인라인 그라디언트)로 되어 있어 그대로 이식 불가(하네스 위반). 이 문서는 그 매핑표다.

## 1. 범위

- **대상**: `/` (홈) 한 페이지. 헤더·푸터는 이미 `app/layout/app-layout.tsx`에 구현됨 — 손대지 않는다.
- **보존**: 섹션 구성·문구·이미지·링크 목적지. `/design`(보존 예외)로 가는 배너의 *링크*는 유지하되 대상 페이지 기획은 별건.
- **제외**: shop/reform/design/custom-order 등 링크 대상 페이지 자체(홈은 진입점만 제공, catch-all이 홈으로 폴백 중).

## 2. 원본 섹션 (7 + SEO)

| # | 섹션 | 내용 | 링크 |
|---|---|---|---|
| 1 | **Hero** | 배너 카드 4개(AI·CUSTOM·STORE·REPAIR), 태그+제목 오버레이 | design·custom-order·shop·reform |
| 2 | **Popular** | "지금 가장 많이 찾는 넥타이" — 인기 상품 4개 + skeleton | shop |
| 3 | **Case (주문제작)** | "단체의 분위기에 맞춰 제작해요" — 이미지 카드 2개 | custom-order |
| 4 | **Lookbook** | "문장 하나로 만드는 넥타이 디자인" — 벤토 그리드 5개(1 main + 4) | design |
| 5 | **Case (수선)** | "수동 넥타이, 자동 매듭으로" — 이미지 카드 2개 | reform |
| 6 | **Partners** | "믿고 맡길 수 있는 제작 경험" — 로고 타일 4개 | — |
| 7 | **Reviews** | "먼저 써본 분들 이야기" — 후기 카드 3개 | — |
| — | **SEO** | `<title>`·description·og·JSON-LD(Organization/WebSite) | — |

## 3. 섹션별 하네스 매핑

공통 3종을 먼저 만든다:
- `SectionHeader` — `HStack justify=between` + `Text as="h2" textStyle="title2"` + 선택적 `Link`(더보기). 원본의 `pt-9/pt-14`·`text-[18px]/2xl` → `title2`(22/30 700)로 통일.
- `Carousel` 패턴 — 모바일 가로 스냅 스크롤은 `ScrollFog direction="horizontal"` + `Flex`(스냅은 `snapType`/`snapAlign` 없으므로 `style` 이스케이프 훅으로 `scrollSnapType`), 데스크톱은 `Grid`. 원본의 `overflow-x-auto [scrollbar-width:none]` 자작 → ScrollFog가 대체(가장자리 페이드까지 포함).
- `Wrap`(max-w-1280 + px) → 헤더/푸터가 쓰는 `Layout`/`Box` 컨테이너 규약 재사용(별도 Wrap 만들지 말고 `Box` maxWidth + 반응형 px 토큰).

| 원본 요소 | essesion |
|---|---|
| `<div className="flex/grid ...">` 레이아웃 | `Flex`/`Grid`/`VStack`/`HStack` 프리미티브 (rule 1) |
| `text-[18px] font-bold` 등 | `Text textStyle=...` 10종 중 매핑 (rule 5) |
| `bg-[#F6F6F4]`, `text-[#999]` | `bg.*`/`fg.*` 시맨틱 토큰 (rule 2·4) |
| `rounded-[14px]` | `r2`/`r3`/`r4` (rule 2) |
| `<img class="object-cover">` + aspect | `ImageFrame ratio=... borderRadius=...` (fallback·onError 내장) |
| gradient overlay + 흰 텍스트 | **결정 D1** (§6) — 기본은 캡션 하단 분리 |
| `hover:-translate-y-0.5 duration-200` | motion 토큰 (rule 참조 `docs/foundation/motion.md`) |
| `<Link>` 카드 | `ImageFrame`을 `Link`로 감싸기 + `focus-visible:outline-stroke-focus-ring` |

**섹션별 구체 매핑**

1. **Hero**: 데스크톱 `Grid columns={4} gap="x3"`, 모바일 ScrollFog+Flex(카드 `flex-[0_0_100%]`). 카드 = `Link > ImageFrame ratio={{base: 4/5, md: 3/4}} borderRadius="r4"`. 태그 = `Chip`(또는 `Text textStyle="captionSm"` 대문자), 제목 = `Text textStyle="title3"`. 오버레이는 ImageFrame `children` 슬롯: **스크림 토큰 면**(D1) + `Float`(하단 좌) 캡션(흰 텍스트).
2. **Popular**: `entities/product` 쿼리(§4) → `Grid columns={{base:2, md:4}}`. 카드는 신규 `ProductCard`(§4). 로딩 시 `Skeleton` 4개. 빈 결과 시 `ContentPlaceholder`.
3·5. **Case**: `Grid columns={{base:1, md:2}} gap="x4"` · 카드 = `Link > ImageFrame ratio={{base:4/3, md:5/4}}` + 스크림(D1) 위 하단 캡션(제목 `title3`, 설명 `caption`, 흰 텍스트).
4. **Lookbook**: 데스크톱 벤토 = `Grid templateColumns="2fr 1fr 1fr"` + 행 높이 지정, main 카드는 `style={{ gridRow: "span 2" }}`(rule 8 `style` 이스케이프 훅 — span은 프리미티브 prop이 아님). 모바일 ScrollFog+Flex.
6. **Partners**: `VStack align=center`(제목 `title2` + 설명 `caption` `fg.neutral-muted`) + `Grid columns={{base:2, md:4}}`. 타일 = `Box bg.neutral-subtle r2`. 로고는 잘리면 안 됨(contain) — ImageFrame은 `object-cover`가 하드코딩(`image-frame.tsx:44`)이고 외부에서 못 바꾼다(className이 img가 아닌 AspectRatio 래퍼로 감). → **shared ImageFrame에 `fit?: "cover" | "contain"` prop 추가(D4)**. `object-contain`은 하네스에서 유지되는 유틸(색·라운드와 달리 object-fit은 안 지워짐, `check-harness.mjs` 통과). 기존 `radii` 맵처럼 정적 맵으로(`object-${fit}` 문자열 보간 금지 — JIT는 리터럴 클래스 필요).
7. **Reviews**: 모바일 ScrollFog+Flex / 데스크톱 `Grid columns={3}`. 카드 = `Box bg.neutral-subtle r3 p="x5"` VStack: 별점(`Text` "★★★★★" + `aria-label="5점 만점에 5점"`), 인용(`body`), `HStack`(`Avatar` + VStack 이름 `labelSm`/출처 `caption`).

## 4. 데이터 의존성 (Popular 섹션)

- **쿼리**: `packages/api-client`의 `listProductsOptions`(`GET /products`)를 TanStack Query로 소비. 훅은 이미 생성돼 있음.
- **`entities/product` 신설**: `ui/product-card.tsx`(+`product-card-skeleton`), 필요 시 `api.ts`(쿼리 옵션 래퍼). 원본 `shared/composite/product-card` 대응. **store 로컬** — admin은 상품을 테이블로 다루므로 shared 승격은 보류(2앱 규칙).
- **⚠ 선행 작업 — 서버 sort/limit 추가 (필수, 클라 정렬 아님)**: `/products`는 현재 4개 등가 필터만 있고 정렬이 `ORDER BY id ASC`로 하드코딩(`apps/api/.../products/router.py:89`), `sort`·`limit` 파라미터가 없다. 정렬은 **반드시 서버에서** — 프론트는 api-client만 쓰고 데이터 로직을 갖지 않는다(대원칙). YeongSeon과 동일한 `SortOption`(`"latest" | "price-low" | "price-high" | "popular"`, 기본 `latest`) + `limit`를 api에 추가한다. 문자열을 원본과 맞추면 프론트 매핑이 0. `likes`는 `_product_query`(router.py:34-46)의 상관 서브쿼리이므로 popular 정렬은 그 식으로 ORDER BY. → 상세 §9.
- **가격 — 이미 노출됨(작업 불필요)**: `products.price` 칼럼 존재(`db/src/db/models/commerce.py:54`, `CheckConstraint price >= 0`), `ProductOut.price`로 API에 노출(`apps/api/.../products/schemas.py:28`), 생성 클라이언트에도 있음(`types.gen.ts` ProductOut.price). ProductCard는 `product.price`를 `₩` 포맷(`international-design.md`)으로 바로 표시.

## 5. 신규 파일

```text
apps/store/src/
├─ pages/home/index.tsx          # 진입점: SEO 메타 + 섹션 조립 (기존 스텁 교체)
├─ features/home/
│  ├─ section-header.tsx         # 공용 섹션 헤더 (title + 더보기 Link)
│  ├─ hero.tsx
│  ├─ popular-products.tsx       # listProducts 쿼리 소비 + Grid
│  ├─ case-section.tsx           # 주문제작·수선 공용 (props로 문구·이미지·href)
│  ├─ lookbook.tsx
│  ├─ partners.tsx
│  └─ reviews.tsx
└─ entities/product/
   ├─ ui/product-card.tsx        # ImageFrame + Text 조합 (+ Skeleton)
   └─ index.ts
```

배너·후기·파트너·케이스 문구는 각 파일 상단 상수로(원본과 동일 방식, YAGNI — CMS화는 §6-I9). 이미지 에셋은 `apps/store/public/images/home/`로 이관(§6-I5).

## 6. 결정 사항 (구현 전 확정)

| ID | 결정 | 권장 |
|---|---|---|
| **D1** | ~~이미지 위 텍스트 가독성~~ **확정: 기능성 스크림 토큰 추가**. 이미지 위 흰 텍스트를 유지하되, 장식 그라디언트가 아닌 **가독성(scrim) 토큰**을 shared에 신규 추가. `gradient.md`가 금지하는 건 *장식* 그라디언트 → 이건 기능성이므로 문서에 예외로 명기. ⇒ 하네스 rule 0에 따라 **shared 토큰 추가 + 디자인 리뷰가 홈 구현의 선행 작업**(§8-0) | 확정 |
| **D2** | ~~ProductCard 가격 노출~~ **해소: 이미 노출됨.** `products.price` 칼럼 + `ProductOut.price` + 생성 클라이언트까지 전부 존재. 추가 작업 없음, `product.price` 사용 | 해소 |
| **D3** | ~~인기 정렬 위치~~ **확정: 서버 정렬.** `/products`에 `sort`(YeongSeon `SortOption` 4종)+`limit` 추가 → codegen 재생성. 클라 정렬 금지(대원칙). 상세 §9 | 확정 |
| **D4** | ~~Partners 로고 컨테이너~~ **확정: shared ImageFrame에 `fit` prop 추가.** cover 하드코딩이라 로고가 잘림 → `fit?: "cover"\|"contain"`(기본 cover, 하위호환) 추가. admin 썸네일에도 재사용 | 확정 |

## 7. 개선 제안

1. **SEO 의존성 제거** — 원본은 `react-helmet-async`. essesion은 **React 19 네이티브 메타데이터 호이스팅**으로 `<title>`/`<meta>`/`<script type="application/ld+json">`을 컴포넌트에서 직접 렌더 → helmet 의존성 불필요(store엔 애초에 없음). PageSeo 같은 래퍼도 불필요.
2. **텍스트 가독성 = 브랜드 정합 기회** — 스크림 대신 캡션 분리(D1-a)로 가면 모노크롬 브랜드와 더 맞고 대비(APCA `inclusive-design.md`)도 안정적. 원본의 반투명 흰 텍스트보다 접근성 우위.
3. **이미지 파이프라인** — 원본은 로컬 PNG(대용량) 직접 서빙. essesion은 §2/§6대로 **GCS + Cloudflare 프록시 캐시** 경유가 목표. 홈은 정적 에셋이라 당장은 public 이관으로 충분하되, Hero 첫 이미지만 `loading="eager"` + `<link rel="preload">`로 LCP 보호, 나머지는 `lazy`. WebP/AVIF 변환은 트래픽 붙으면.
4. **접근성** — 캐러셀 `role`/`aria-label`, 링크 카드 포커스 링(하네스 `focus-visible:outline-stroke-focus-ring`), 별점 `aria-label`, 파트너 로고 의미 있는 `alt`. 원본엔 포커스/별점 aria 없음.
5. **모션 토큰화** — hover `translate`·`transition`을 `motion.md`의 duration/ease 토큰으로(임의 `duration-200` 금지).
6. **콘텐츠 하드코딩 유지(지금은)** — 배너·후기·파트너를 admin에서 관리하는 테이블로 뺄 수 있으나 현 단계 과설계(YAGNI). 운영자가 배너를 자주 바꾸는 게 확인되면 그때 도입.
7. **CSR SEO 한계** — Cloudflare Workers 정적 SPA라 초기 HTML엔 메타가 없다(런타임 호이스팅). 구글은 JS 렌더링하나, 완전한 SEO/OG 프리뷰가 중요하면 홈만 프리렌더(빌드타임 HTML) 고려 — 필요성 확인 전엔 보류.

## 8. 작업 순서

0. **선행 A — shared 스크림 토큰(D1)**: 이미지 가독성 스크림 토큰을 `theme.css`/`design-token-reference.md`에 추가하고 `gradient.md`에 "기능성(비장식) 예외" 한 줄 명기. 하네스 rule 0 위반 방지(디자인 시스템 리뷰 신호).
0b. **선행 B — shared ImageFrame `fit` prop(D4)**: `fit?: "cover" | "contain"` 추가(정적 맵, 기본 cover).
0c. **선행 C — api `/products` sort·limit(D3)**: §9대로 api 수정 → `pnpm codegen` → `packages/api-client` 재생성물 같은 커밋(CI codegen-drift 통과 확인). 이게 되어야 Popular 섹션이 서버 정렬로 동작.
2. `SectionHeader` + 캐러셀 패턴(ScrollFog+Flex↔Grid) 공용화.
3. Hero → Case(공용) → Lookbook → Partners → Reviews 순으로 정적 섹션(데이터 무관) 먼저.
4. `entities/product` + `ProductCard` + Popular 섹션(쿼리 연결).
5. `pages/home/index.tsx`에서 SEO 메타 + 섹션 조립, 스텁 교체.
6. `pnpm lint`(하네스 정적 검사 통과 필수) → `pnpm --filter store dev`로 반응형(sm480/md768/lg1280) 확인 → typecheck.

## 9. api `/products` sort·limit 추가 (선행 C 상세)

현재: `list_products`(`apps/api/src/api/domains/products/router.py:71-91`)는 4개 등가 필터만 받고 `query.order_by(Product.id)`(line 89, **ASC**)로 고정. `_product_query(user)`(router.py:33-46)가 `likes`(ProductLike 카운트 상관 서브쿼리)·`is_liked`를 라벨로 포함.

변경:
1. `schemas.py`: `SortOption = Literal["latest", "price-low", "price-high", "popular"]` 추가 (YeongSeon `packages/shared/src/types/view/product.ts`와 동일 문자열 → 프론트 매핑 0).
2. `router.py` `list_products` 시그니처에 `sort: SortOption = "latest"`, `limit: Annotated[int | None, Query(gt=0, le=100)] = None` 추가(`Query` import).
3. ORDER BY 매핑(전부 `id.desc()` 타이브레이커): latest→`id.desc()` / price-low→`price.asc(), id.desc()` / price-high→`price.desc(), id.desc()` / popular→`likes.desc(), id.desc()`. line 89 교체. popular용으로 `_product_query`가 `likes` 식을 노출하도록 조정.
4. `limit` 있으면 `query = query.limit(limit)`.
5. `apps/api/tests/test_products.py`에 popular 정렬·limit 절단 테스트(인가/likes 서브쿼리는 실 Postgres 필요 → testcontainers, 대원칙).

⚠ 기본 정렬이 오늘의 `id ASC`에서 `latest`(id DESC)로 **의도적으로 바뀐다** — YeongSeon 기본 동작과 일치시키는 것.

파일: `products/schemas.py` · `products/router.py` · `tests/test_products.py`. 이후 `pnpm codegen`.
