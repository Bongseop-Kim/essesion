/**
 * 공개 페이지의 제목·설명 정본. 페이지(PageMeta)와 Worker(worker.ts)가 함께 쓴다 —
 * JS를 실행하지 않는 공유 스크래퍼도 페이지와 같은 문구를 받게 하려는 것이다.
 */

export const ORIGIN = "https://essesion.com";
export const DEFAULT_OG_IMAGE = `${ORIGIN}/og-image.png`;
export const DEFAULT_DESCRIPTION =
  "영선산업(ESSE SION)은 맞춤 넥타이 제작, 단체 넥타이, 샘플 주문, 넥타이 수선·리폼을 운영합니다.";

/** 사이트맵의 고정 주소 목록이기도 하다. */
export const ROUTE_META = {
  "/": {
    title: "영선산업 | 맞춤 넥타이 제작·수선 전문",
    description:
      "영선산업은 맞춤 넥타이 제작, 단체 넥타이, 샘플 주문, 넥타이 수선·리폼을 운영합니다. 상호명은 ESSE SION입니다.",
  },
  "/shop": {
    title: "스토어 | 영선산업",
    description:
      "ESSE SION의 3폴드·스폴더라토·니트·보타이 넥타이 컬렉션을 둘러보세요.",
  },
  "/design": {
    title: "디자인 템플릿 | 영선산업",
    description: "템플릿을 고르고 색과 로고를 넣어 나만의 넥타이를 만드세요.",
  },
  "/custom-order": {
    title: "맞춤 넥타이 제작 주문 | 영선산업",
    description:
      "수량, 원단, 봉제 방식과 마감 사양을 선택하고 맞춤 넥타이 제작 비용을 확인하세요.",
  },
  "/sample-order": {
    title: "샘플 제작 주문 | 영선산업",
    description:
      "단체 주문 전 원단과 봉제 품질을 확인할 수 있는 넥타이 샘플을 제작해 드립니다.",
  },
  "/reform": {
    title: "넥타이 수선·리폼 | 영선산업",
    description:
      "폭 조절, 길이 수선, 리폼까지 — 소중한 넥타이를 새것처럼 되살려 드립니다.",
  },
  "/faq": {
    title: "자주 묻는 질문 | 영선산업",
    description:
      "ESSE SION의 배송, 주문, 맞춤 제작, 수선 이용 방법을 안내합니다.",
  },
  "/notice": {
    title: "공지사항 | 영선산업",
    description:
      "ESSE SION 서비스 운영, 주문, 결제, 수선과 제작 관련 공지사항을 확인하세요.",
  },
  "/privacy-policy": {
    title: "개인정보처리방침 | 영선산업",
    description:
      "ESSE SION의 개인정보 처리 목적, 항목, 보유기간과 정보주체의 권리를 안내합니다.",
  },
  "/terms-of-service": {
    title: "이용약관 | 영선산업",
    description:
      "ESSE SION의 상품, 수선, 맞춤 제작, 디자인 서비스 이용 조건을 안내합니다.",
  },
  "/refund-policy": {
    title: "환불정책 | 영선산업",
    description:
      "ESSE SION의 일반 상품, 수선, 맞춤 제작의 취소·교환·환불 기준을 안내합니다.",
  },
} as const;

export function productMeta(product: {
  id: number;
  name: string;
  info: string;
  image: string;
}) {
  return {
    title: `${product.name} | 영선산업`,
    description: product.info,
    path: `/shop/${product.id}`,
    ogImage: product.image.startsWith("http")
      ? product.image
      : `${ORIGIN}${product.image}`,
    ogType: "product" as const,
  };
}
