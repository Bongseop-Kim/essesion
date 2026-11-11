# 스토어 이미지 로딩 개선 — 상품 상세·주문제작·수선

2026-11-11 실측 기준으로 작성했다. 브랜치는 `perf/image-loading`. 상품 상세(`/shop/:id`),
주문제작(`/custom-order`), 수선(`/reform`) 세 페이지가 이미지를 받느라 브라우저 탭의
로딩 표시가 오래 돌고 체감 속도가 느리다. 아래 1~4를 효과 ÷ 난이도 순으로 위에서부터 실행하고, 5(문서 기록)는 마지막에
한다. 각 항목은 독립 PR로 나눠도 된다.

## 왜 필요한가

2026-11-11 운영(essesion.shop·assets.essesion.shop)에 GET으로 실측했다. 시간은 개발자
로컬 네트워크에서 잰 단일 샘플이라 경향만 본다.

- **상품 이미지가 원본 PNG 그대로**: 1254×1254 PNG가 장당 1.6~2.7MB, Cloudflare 캐시
  HIT 상태에서도 장당 3~5초. 상품당 대표 1장 + 상세 7~11장이라 상세 페이지 하나가
  약 15~25MB다. 같은 파일을 `cwebp -q 80`으로 변환하면 원해상도 59KB(-96%), 800px
  16KB. 업로드 경로(`apps/api/src/api/domains/admin/products.py:595` upload-url →
  finalize)에 리사이즈·포맷 변환이 없고, 10MB까지 원본을 그대로 공개 버킷에 둔다.
  상품 목록 카드(`apps/store/src/entities/product/ui/product-card.tsx:23`)도 같은 원본을 쓴다.
- **화면 밖 이미지까지 즉시 다운로드**: 공용 `ImageFrame`
  (`packages/shared/src/components/image-frame.tsx:57`)의 `<img>`에 `loading`·`decoding`
  기본값이 없다. 주문제작 47장(4.4MB), 수선 약 4.7MB가 진입 즉시 전부 요청된다.
- **수선 영상 4개가 즉시 다운로드**: `ReformVideo`
  (`apps/store/src/features/reform/ui/reform-service-guide.tsx:1230`)가 `autoPlay`라
  `preload="metadata"`가 무시된다. `reform.mp4` 4.7MB + `reform-vertical.mp4` 2.2MB +
  `point-fabric.mp4` 0.9MB + `point-mechanism.mp4` 0.5MB = 8.3MB. `reform.mp4`(854×480,
  약 3Mbps, 오디오 없음)를 해상도 유지 `libx264 -crf 28 -preset slow`로 재인코딩하면
  1.15MB(-76%) — 화질은 육안 확인 전이다.
- **정적 이미지 캐시가 매번 재검증**: `/images/*`가 Workers 정적 자산 기본값
  `cache-control: public, max-age=0, must-revalidate`로 나간다
  ([Workers static assets headers](https://developers.cloudflare.com/workers/static-assets/headers/)).
  `apps/store/public/_headers`에 `/images` 규칙이 없어 재방문마다 이미지 수십 장을 304로
  왕복한다. 원본도 1200px라 작은 카드에 과하다(예: `custom-order/yarn-frontback.webp`
  376KB → 800px 재압축 171KB).

실패 모드: 실측 1~2건을 페이지 전체 수치로 일반화하는 것, 그리고 Cloudflare 변환을 켜기만
하고 실제 응답이 WebP·리사이즈로 나오는지 확인하지 않는 것.

## 범위 밖

- admin 화면의 이미지, 비공개 signed URL 이미지(주문·견적·수선 접수 사진)는 다루지 않는다.
- 업로드 시점 변환·백필(api에 Pillow 도입)은 하지 않는다 — 기각한 대안 참조.
- 홈(`/`) 이미지는 이 플랜에 포함하지 않는다. 4번의 `_headers` 규칙은 홈에도 자동 적용된다.

## 실행 조건

- 2번은 Cloudflare 대시보드에서 essesion.shop 존의 Images Transformations 활성화가
  선행돼야 한다(사람이 수행). 활성화 전에는 2번 코드를 머지하지 않는다 — 비활성 존에서
  `/cdn-cgi/image/` URL은 이미지를 반환하지 않는다.
- 이미 실행된 `docs/reviews/perf-cost-reduction-2026-08-19.md` 7번(assets-proxy 1년 immutable
  캐시)과 겹치는 항목은 없다. 그 캐시는 원본 PNG를 그대로 캐시할 뿐 크기는 줄이지 않는다.

## 절차

### 1. `ImageFrame` 기본 lazy loading (원안 2번)

1. `packages/shared/src/components/image-frame.tsx:57`의 `<img>`에 `loading="lazy"`,
   `decoding="async"`를 기본값으로 넣는다. `{...props}`보다 앞에 둬서 호출부가 덮어쓸 수
   있게 한다. 근거: 화면 밖 이미지를 뷰포트 근처에서만 받게 해 첫 로딩의 요청 수를 줄인다.
2. 첫 화면에 보이는 이미지는 `loading="eager"` + `fetchPriority="high"`로 덮어쓴다
   (React 19라 `fetchPriority` prop을 그대로 쓸 수 있다).
   - 상품 대표 이미지: `apps/store/src/pages/shop/detail.tsx:370`
   - 주문제작 히어로: `apps/store/src/features/custom-order/ui/custom-order-service-guide.tsx:189`
   근거: lazy를 첫 화면 이미지에 걸면 LCP가 오히려 늦어진다.
3. `ImageFrame`은 admin도 쓰므로 admin 첫 화면 이미지에 영향이 없는지
   `pnpm --filter admin build`와 화면 확인으로 본다.
4. `ratio="auto"` 이미지는 로드 전 자리를 확보한다. `image-frame.tsx`의 auto 분기에서 로드
   전에는 최소 높이(정사각 비율)를 잡고, `onLoad` 후 원본 비율로 푼다. 근거: 상품 상세
   이미지(`apps/store/src/pages/shop/detail.tsx:633`)는 `ratio="auto"`라 로드 전 높이가 0이고,
   7~11장이 전부 뷰포트 근처로 판정돼 lazy가 걸려도 한꺼번에 받는다. 로드될 때마다 화면이
   밀리는 문제도 있다. 상세 이미지 비율은 1254×1254와 1086×1448이 섞여 있어(2026-11-11 실측)
   고정 비율로는 못 바꾼다.

한계: 4를 넣어도 상품 상세의 실제 해결책은 2번(용량 축소)이다. lazy는 주문제작·수선처럼
비율이 고정된 페이지에서 효과가 크다.

### 2. 공개 업로드 이미지를 Cloudflare Image Transformations로 리사이즈·WebP 서빙 (원안 1번)

대상은 공개 assets 버킷 이미지 전부다 — 상품(대표·상세·목록 카드), 리뷰 사진, 팝업 이미지.

1. (사람) Cloudflare 대시보드 → Images → Transformations에서 essesion.shop 존을 활성화한다.
   Sources는 기본값(같은 존만 허용)을 유지한다 — `assets.essesion.shop`이 같은 존이므로
   추가 origin은 필요 없을 것으로 본다(추정, 3번 검증으로 확인). "any origin"은 켜지 않는다.
   출처: [Sources](https://developers.cloudflare.com/images/transform-images/sources/).
2. store에 이미지 URL 헬퍼 하나를 만든다(예: `apps/store/src/shared/lib/image-url.ts`).
   입력 URL이 `https://assets.essesion.shop/`으로 시작할 때만
   `https://essesion.shop/cdn-cgi/image/width=<w>,format=auto,quality=80,onerror=redirect/<원본URL>`로 바꾸고,
   그 외(로컬 fake-gcs, 과거 storage.googleapis.com 직통 URL)는 그대로 돌려준다.
   URL 형식 출처: [Transform via URL](https://developers.cloudflare.com/images/transform-images/transform-via-url/).
   근거: 백엔드·DB 변경 없이 기존 이미지 전부에 즉시 적용되고, 로컬 개발은 영향이 없다.
   `onerror=redirect`는 변환이 치명적으로 실패하면 원본 URL로 리다이렉트한다. URL 방식에서만,
   같은 존(서브도메인 포함 — `assets.essesion.shop` 해당)일 때만 동작한다. 한도 초과(`9422`)도
   이 경로로 원본 폴백되는지는 문서에 없다 — 검증 항목에서 확인하고, 안 되면 `ImageFrame`
   호출부의 `onError`에서 원본 URL로 한 번 교체하는 폴백을 추가한다. 근거: 한도에 닿아도
   이미지가 깨지지 않게 한다.
3. 헬퍼를 공개 이미지 호출부의 `src`에 적용한다. 너비는 용도별 고정값 두 가지만 쓴다.
   - 너비 1200: 상품 대표 이미지 `apps/store/src/pages/shop/detail.tsx:370`
   - 너비 1200: 상품 상세 이미지 `apps/store/src/pages/shop/detail.tsx:633`
   - 너비 1200: 팝업 이미지 `apps/store/src/features/popup-notice/ui/popup-notice-modal.tsx:137`
   - 너비 600: 상품 목록 카드 `apps/store/src/entities/product/ui/product-card.tsx:23`
   - 너비 600: 리뷰 사진 `apps/store/src/features/reviews/ui/review-list-section.tsx:121`
   `srcSet`·`sizes`는 쓰지 않는다. 근거: 같은 이미지가 WebP q80에서 800px 16KB, 1200px 39KB,
   원해상도 59KB(2026-11-11 실측)라 너비별 이득이 20~40KB뿐이고, `sizes`를 레이아웃과
   다르게 적으면 엉뚱한 크기를 받는다. 고유 변환도 이미지당 1건으로 줄어든다.
   리뷰 사진을 확대해 보는 뷰어가 있으면 확대 화면에는 1200을 쓴다.
4. CSP는 바꾸지 않는다 — 변환 URL은 essesion.shop(`img-src 'self'`)이다.
5. 과금: 무료 플랜은 월 5,000건(고유 변환)까지, 초과분은 과금되지 않고 새 변환이
   `9422` 오류를 낸다. 고유 변환 = 원본 × 파라미터 조합이며 `format`·`quality`는 세지 않는다.
   서빙 횟수와 무관하게 같은 달 같은 변환은 1건이다. 현재 상품 7개 × 이미지 약 10장에
   대표 이미지만 두 너비(카드 600·상세 1200)라 약 80건/월(리뷰·팝업 제외)로 여유가 크다.
   출처: [Images pricing](https://developers.cloudflare.com/images/pricing/).

### 3. 수선 영상: 재인코딩 + 아래쪽 영상 뷰포트 재생 (원안 3번)

1. `apps/store/public/images/reform/`의 mp4 4개를 해상도 유지, 오디오 제거,
   `-c:v libx264 -crf 28 -preset slow -movflags +faststart`로 재인코딩해 교체한다.
   교체 전 원본과 나란히 재생해 화질을 확인하고, 뭉개지면 crf를 24~26으로 낮춘다.
   파일명을 바꾸면(예: `reform-v2.mp4`) 4번의 캐시 규칙과 충돌하지 않는다.
   근거: 코드 변경 없이 8.3MB의 대부분이 줄어든다(히어로 4.7MB → 1.15MB 실측). 먼저 한다.
2. 히어로 아래의 영상 3개(`reform-service-guide.tsx:549`의 `AUTO_POINTS`)만 뷰포트 재생으로
   바꾼다. `ReformVideo`(`apps/store/src/features/reform/ui/reform-service-guide.tsx:1213`)에
   옵션을 하나 두어, 켜지면 `autoPlay`를 빼고 `preload="none"`으로 두고 IntersectionObserver로
   화면에 들어오면 `play()`, 벗어나면 `pause()`한다. 히어로(`reform-service-guide.tsx:331`)는
   첫 화면이라 지금처럼 `autoPlay`를 유지한다. reduced-motion 분기(`controls`, 재생 안 함)는
   유지한다. 근거: 아래쪽 영상은 포스터만 먼저 보이고, 보일 때만 받는다.

### 4. 정적 이미지 캐시 헤더 + 재압축 (원안 4번)

1. `apps/store/public/_headers`에 `/images/*` 규칙을 추가해
   `Cache-Control: public, max-age=86400`을 준다. 파일명에 해시가 없어 `immutable`은 쓰지
   않는다. 같은 이름으로 교체하면 최대 하루 동안 이전 파일이 보이니, 교체 시에는 파일명을 바꾼다.
   기존 `/*` 규칙의 CSP 등 보안 헤더가 `/images/*` 응답에도 그대로 붙는지 검증에서 확인한다.
2. `apps/store/public/images/custom-order/`, `apps/store/public/images/reform/`의 webp 중
   긴 변이 1200px인 파일을 실제 표시 크기에 맞게 긴 변 800px, `cwebp -q 78`로 재압축한다.
   표시가 큰 히어로(`custom-order/hero.webp` 등)는 제외한다. 근거: 카드 표시 폭이 대부분
   400px 이하라 2x DPR에서도 800px로 충분하다.

### 5. 에셋 운영 규칙을 `apps/store/AGENTS.md`에 기록

1~4가 배포된 뒤 `apps/store/AGENTS.md`에 "이미지·영상 에셋" 섹션을 짧게 추가한다.
2번이 실제로 동작하기 전에는 쓰지 않는다 — 공개 업로드 규칙이 그때부터 참이다.
- `public/images/` 정적 에셋은 Cloudflare 변환을 거치지 않는다 — 직접 WebP로, 표시 크기
  기준(카드는 긴 변 800px)으로 넣는다. 교체할 때는 파일명을 바꾼다(4번의 하루 캐시).
- mp4는 해상도 유지, 오디오 제거, `crf 28`, `faststart`로 재인코딩해서 넣는다.
- `og-image.png`·파비콘은 SNS 미리보기·브라우저 호환을 위해 PNG로 둔다.
- 공개 업로드 이미지(상품·리뷰·팝업)는 형식·크기를 신경 쓰지 않아도 된다. 대신 화면에
  표시할 때 반드시 2번의 이미지 URL 헬퍼를 거친다.
근거: 규칙이 문서에 없으면 원본 크기 에셋을 그대로 넣는 일이 반복된다.

## 검증

- 상품 상세에서 DevTools Network의 Img 필터로 확인한다. 응답 `content-type: image/webp`
  (또는 avif), 장당 100KB 이하, 페이지 전체 이미지 전송량 1MB 이하.
- `curl -sI "https://essesion.shop/cdn-cgi/image/width=800,format=webp/<상품 원본 URL>"` →
  200, `content-type: image/webp`. 9422나 403이면 2번 대시보드 설정(Sources)을 다시 본다.
- 폴백 확인: 존재하지 않는 원본 경로나 깨진 파일로 변환 URL을 요청해 원본 URL로
  리다이렉트(3xx)되는지 본다. 9422 시 폴백 여부는 Cloudflare 문서·지원으로 확인하고,
  확인되지 않으면 2번의 `onError` 폴백을 넣는다.
- 리뷰 사진·팝업 이미지도 Network에서 `image/webp`로 내려오는지 확인한다.
- 주문제작·수선에서 스크롤하지 않은 상태의 Img 요청 수가 첫 화면 분량(수 장)뿐이고,
  탭 로딩 표시가 곧 멈춘다. 수선 페이지 첫 진입 시 mp4 요청은 히어로 1개뿐이다.
- `curl -sI https://essesion.shop/images/custom-order/hero.webp | grep -iE "cache-control|content-security-policy"`
  → `max-age=86400`과 CSP가 함께 나온다.
- Lighthouse 모바일(상품 상세·주문제작·수선)로 LCP와 총 전송량을 적용 전후로 비교해
  `docs/reviews/`에 남긴다.
- `pnpm lint && pnpm build && pnpm typecheck && pnpm test`, 문서 링크는 `pnpm architecture:check`.

## 되돌리는 법 / 상향 신호

- 2번: 헬퍼가 원본 URL을 그대로 돌려주게 바꾸면 즉시 원상복구된다. 이미지가 깨지면 되돌린다.
- **상향 신호**: Cloudflare 대시보드(Images → Transformations)의 월 고유 변환 수가
  **3,000건**을 넘으면 업로드 시점 변환(기각한 대안 1)으로 전환하는 플랜을 새로 쓴다.
  이미지당 1~2건이라 원본 약 2,000~3,000장(상품·리뷰·팝업 합계)에 해당한다. 무료 한도 5,000건에
  닿기 전에 전환을 끝내는 게 목적이다.
- 4번: 캐시 규칙을 지워도 이미 받은 브라우저는 최대 하루 이전 파일을 쓴다 — 급하면 파일명을 바꾼다.

## 기각한 대안

- **업로드 시점 WebP 변환(api + Pillow) + 기존 상품 백필**: Cloudflare 의존은 없지만 api
  의존성 추가, finalize 로직·스키마 변경, 백필 스크립트가 필요하고, 고객이 GCS로 직접 올리는
  리뷰 사진은 finalize에서 받아 변환 후 재업로드하는 경로까지 필요하다. Cloudflare 무료 한도는
  서빙 횟수가 아니라 고유 변환 수라 현재 규모에서는 비용 이점이 없다. 상향 신호(월 3,000건)에
  닿거나 Cloudflare를 떠날 때 재론한다.
- **assets-proxy Worker에서 `cf.image`로 변환**: 너비를 쿼리로 받아야 해서 쿼리를 버리는
  현재 캐시 설계(`infra/cloudflare/assets-proxy/src/index.ts`)를 바꿔야 한다. URL 변환으로 충분하다.
- **정적 이미지를 Vite import로 옮겨 해시 파일명 + immutable**: 100장이 넘는 경로 문자열을
  import로 바꾸는 diff가 크다. 하루 캐시로 재검증 왕복은 대부분 사라진다. 교체가 잦아지면 재론한다.
