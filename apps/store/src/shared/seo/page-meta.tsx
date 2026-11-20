/**
 * 페이지 head 메타 일괄 렌더 — React 19 네이티브 메타데이터 호이스팅(react-helmet 불필요).
 * index.html의 기본 메타는 앱 시작 때 걷어내므로(default-meta.ts) 여기서 렌더한 것만 남는다.
 */

import { DEFAULT_DESCRIPTION, DEFAULT_OG_IMAGE, ORIGIN } from "./site-meta";

type PageMetaProps = {
  title: string;
  description?: string;
  /** canonical 경로 (예: "/faq"). 지정 시 canonical + og:url을 렌더한다. */
  path?: string;
  /** 절대 URL. 미지정 시 기본 og:image를 사용한다. */
  ogImage?: string;
  ogType?: "website" | "product";
  noindex?: boolean;
};

export function PageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  ogImage = DEFAULT_OG_IMAGE,
  ogType = "website",
  noindex = false,
}: PageMetaProps) {
  const url =
    path === undefined ? undefined : path === "/" ? ORIGIN : `${ORIGIN}${path}`;
  return (
    <>
      <title>{title}</title>
      <meta property="og:title" content={title} />
      <meta property="og:type" content={ogType} />
      <meta name="description" content={description} />
      <meta property="og:description" content={description} />
      {url !== undefined && <meta property="og:url" content={url} />}
      {url !== undefined && <link rel="canonical" href={url} />}
      <meta property="og:image" content={ogImage} />
      {noindex && <meta name="robots" content="noindex, nofollow" />}
    </>
  );
}
