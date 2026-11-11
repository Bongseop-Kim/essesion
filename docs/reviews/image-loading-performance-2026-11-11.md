# 스토어 이미지 로딩 개선 — 상품 상세·주문제작·수선 (2026-11-11)

플랜 `docs/plans/image-loading-performance.md`(실행 완료 후 삭제)를 실행했다. 상품 상세(`/shop/:id`), 주문제작(`/custom-order`),
수선(`/reform`)이 이미지를 받느라 탭 로딩 표시가 오래 돌던 문제다. PR #103(머지 커밋 `4d18d42`)으로 배포했다.

## 한 것

- **공개 업로드 이미지 변환** — Cloudflare Image Transformations를 essesion.shop 존에 켜고(Sources "This zone only"),
  `apps/store/src/shared/lib/image-url.ts`의 `resizedImage(url, 600 | 1200)`로 `assets.essesion.shop` URL만
  `/cdn-cgi/image/width=…,format=auto,quality=80,onerror=redirect/<원본>`으로 바꾼다. 적용: 상품 대표·상세·팝업 1200,
  상품 카드·리뷰 사진 600. `srcSet`은 쓰지 않는다.
- **`ImageFrame`**(`packages/shared/src/components/image-frame.tsx`) — `loading="lazy"`·`decoding="async"` 기본값,
  `ratio="auto"`는 로드 전 정사각 자리 확보(CSS `aspect-ratio: auto 1/1`), `fallbackSrc` prop 추가(변환 URL 실패 시 원본을
  한 번 더 시도). 첫 화면 이미지(상품 대표, 주문제작 히어로)는 `loading="eager" fetchPriority="high"`.
- **수선 영상** — `reform.mp4` 4.7MB → 1.15MB, `reform-vertical.mp4` 2.2MB → 0.65MB 재인코딩. 히어로 아래 영상 3개는
  `preload="none"` + IntersectionObserver로 화면에 들어올 때만 재생(미지원 환경은 즉시 재생).
- **정적 이미지** — `apps/store/public/_headers`에 `/images/*` `max-age=86400`. webp 36장을 긴 변 800px·q78로 재압축
  (6.8MB → 3.1MB).
- **규칙 기록** — `apps/store/AGENTS.md` "이미지·영상 에셋".

## 플랜과 달라진 점

- `point-fabric.mp4`·`point-mechanism.mp4`는 재인코딩 이득이 5~7%뿐이라 그대로 뒀다.
- 재인코딩한 mp4는 파일명을 바꾸지 않았다 — 캐시 규칙과 같은 배포로 나가 이전 캐시가 없었다.
- 한도 초과(`9422`) 때 `onerror=redirect`가 동작하는지 문서로 확인되지 않아, 플랜의 예비안대로 `fallbackSrc` 폴백을 넣었다.
- 변환 URL은 절대 URL이 아니라 상대 경로(`/cdn-cgi/image/…`)다 — CSP `img-src 'self'`에 들어간다.

## 검증 (2026-11-11 운영, curl)

- 상품 대표 이미지 원본 PNG 1,649,994B → 변환 600px AVIF 7,358B / WebP 8,964B, 1200px AVIF 47,482B / WebP 56,060B. 모두 200.
- 없는 원본으로 변환 URL 요청 → 원본 URL로 리다이렉트(`onerror=redirect` 동작).
- `/images/reform/reform.mp4` → `cache-control: public, max-age=86400` + CSP 동반, 1,148,713B. `reform-vertical.mp4` 652,616B.
- 배포 번들(`/assets/index-*.js`)에 `cdn-cgi/image` 경로 포함.
- CI(js·architecture·py·contract·codegen-drift·e2e·osv-scan) 통과, shared vitest 72·store vitest 198.

## 하지 못한 것

- **Lighthouse 적용 전후 비교** — 적용 전 수치를 재지 않고 배포해 비교할 기준이 없다.
- **브라우저 Network 실측**(첫 화면 Img 요청 수, 수선 첫 진입 mp4 1개, 리뷰·팝업 이미지 형식) — curl로만 확인했다.
- **`9422` 실제 동작** — 한도에 닿아야 볼 수 있다. `fallbackSrc`가 대비한다.

## 상향 신호

Cloudflare 대시보드(Images → Transformations)의 월 고유 변환 수가 **3,000건**을 넘으면 업로드 시점 변환(api + Pillow, 기존 이미지
백필)으로 전환하는 플랜을 새로 쓴다. 무료 한도는 5,000건이고 초과분은 과금 없이 새 변환이 `9422`를 낸다. 현재는 상품 7개 기준
약 80건/월.

## 되돌리는 법

`resizedImage`가 원본 URL을 그대로 돌려주게 바꾸면 변환 이전으로 돌아간다. 정적 이미지는 캐시 규칙을 지워도 최대 하루 이전
파일이 남으므로 급하면 파일명을 바꾼다.
