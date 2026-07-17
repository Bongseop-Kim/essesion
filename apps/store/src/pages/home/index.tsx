import { Box, Text } from "@essesion/shared";

import {
  CaseSection,
  Hero,
  Lookbook,
  Partners,
  PopularProducts,
  Reviews,
} from "@/features/home";

const DESCRIPTION =
  "영선산업은 맞춤 넥타이 제작, 단체 넥타이, 샘플 주문, 넥타이 수선·리폼을 운영합니다. 상호명은 ESSE SION입니다.";

// schema.org 구조화 데이터 — 검색 결과 리치스니펫. 인라인 렌더(JSON-LD는 문서 어디서나 유효).
const HOME_JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://essesion.shop/#organization",
      name: "영선산업",
      alternateName: ["ESSE SION", "essesion"],
      url: "https://essesion.shop",
      logo: "https://essesion.shop/logo/logo.png",
      telephone: "042-626-9055",
      address: { "@type": "PostalAddress", addressCountry: "KR" },
    },
    {
      "@type": "WebSite",
      "@id": "https://essesion.shop/#website",
      url: "https://essesion.shop",
      name: "영선산업",
      alternateName: ["ESSE SION"],
      publisher: { "@id": "https://essesion.shop/#organization" },
    },
  ],
};

export function Home() {
  return (
    <>
      {/* React 19 네이티브 메타데이터 호이스팅 — react-helmet 불필요 */}
      <title>영선산업 | 맞춤 넥타이 제작·수선 전문</title>
      <meta name="description" content={DESCRIPTION} />
      <meta
        property="og:title"
        content="영선산업 | 맞춤 넥타이 제작·수선 전문"
      />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:url" content="https://essesion.shop" />
      <link rel="canonical" href="https://essesion.shop" />
      <script type="application/ld+json">{JSON.stringify(HOME_JSON_LD)}</script>

      {/* 히어로는 배너별 h3 캐로셀이라 문서 h1은 핵심 문구로 별도 제공 (route-error·not-found와 같은 sr-only 패턴) */}
      <Text as="h1" textStyle="title1" className="sr-only">
        영선산업 — 맞춤 넥타이 제작·수선 전문
      </Text>
      <Hero />
      <PopularProducts />
      <CaseSection
        title="단체의 분위기에 맞춰 제작해요"
        more="주문 제작 상담하기"
        href="/custom-order"
        items={[
          {
            nm: "워크숍과 행사에 맞춘 기업 넥타이",
            desc: "로고, 컬러, 행사 분위기를 반영해 제작합니다",
            image: "/images/home/custom1-1448.webp",
            srcSet:
              "/images/home/custom1-724.webp 724w, /images/home/custom1-1448.webp 1448w",
          },
          {
            nm: "관공서 단체 착용을 위한 넥타이",
            desc: "격식 있는 자리에도 어울리도록 단정하게 완성합니다",
            image: "/images/home/custom2-1448.webp",
            srcSet:
              "/images/home/custom2-724.webp 724w, /images/home/custom2-1448.webp 1448w",
          },
        ]}
      />
      <Lookbook />
      <CaseSection
        title="수동 넥타이, 자동 매듭으로 바꿔보세요"
        more="수선 맡기기"
        href="/reform"
        items={[
          {
            nm: "손으로 묶던 넥타이를 간편한 자동 매듭으로",
            desc: "매번 매듭을 잡지 않아도 단정하게 착용할 수 있어요",
            image: "/images/home/repair1-1448.webp",
            srcSet:
              "/images/home/repair1-724.webp 724w, /images/home/repair1-1448.webp 1448w",
          },
          {
            nm: "행사·출근용 넥타이를 더 편하게 착용",
            desc: "기존 넥타이의 분위기는 살리고 착용 방식만 바꿔드려요",
            image: "/images/home/repair2-1448.webp",
            srcSet:
              "/images/home/repair2-724.webp 724w, /images/home/repair2-1448.webp 1448w",
          },
        ]}
      />
      <Partners />
      <Reviews />
      <Box height={{ base: 48, md: 64 }} />
    </>
  );
}
