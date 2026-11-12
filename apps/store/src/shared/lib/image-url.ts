// 공개 assets 버킷 이미지를 Cloudflare Image Transformations로 리사이즈·WebP/AVIF 서빙한다
// (docs/plans/image-loading-performance.md 2번). 원본은 1~3MB PNG라 그대로 쓰면 안 된다.
// ponytail: 너비는 용도별 고정값 둘뿐 — srcSet은 이득(20~40KB)보다 sizes 오류 위험이 크다.
// ponytail: 도메인 이전 동안 두 호스트를 모두 받는다 — DB의 이미지 주소를 .com으로 갱신한 뒤
// 이전 정리 때 .shop을 지운다 (docs/plans/domain-move-essesion-com.md E-4).
const ASSETS_ORIGINS = [
  "https://assets.essesion.shop/",
  "https://assets.essesion.com/",
];

type ImageWidth = 600 | 1200;

/**
 * ImageFrame에 그대로 펼쳐 넣는 props. 변환이 실패하면(존 비활성·무료 한도 초과 등)
 * fallbackSrc로 원본을 받는다. assets 출처가 아니면(로컬 fake-gcs 등) 그대로 돌려준다.
 */
export function resizedImage(
  url: string | null | undefined,
  width: ImageWidth,
): { src: string | undefined; fallbackSrc?: string } {
  if (!url || !ASSETS_ORIGINS.some((origin) => url.startsWith(origin))) {
    return { src: url ?? undefined };
  }
  return {
    // 상대 경로 — 스토어와 같은 존에서 변환하므로 CSP img-src 'self'에 들어간다.
    src: `/cdn-cgi/image/width=${width},format=auto,quality=80,onerror=redirect/${url}`,
    fallbackSrc: url,
  };
}
