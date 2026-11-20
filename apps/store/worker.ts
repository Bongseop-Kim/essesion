// 정적 자산 앞에서 세 가지를 한다 (wrangler.jsonc run_worker_first).
// 1. mp4 Range — Workers 정적 자산은 Range 요청에도 200 + 전체 파일을 돌려준다(Accept-Ranges 없음).
//    영상은 일시정지 후 이어받기·반복 재생·Safari 재생에 206이 필요하므로 응답을 잘라 준다.
//    ponytail: 파일 전체를 메모리에 올려 자른다 — 영상이 수 MB를 넘기면 R2 등 Range를 지원하는 저장소로 옮긴다.
// 2. /sitemap.xml — 고정 주소에 공개 상품 주소를 더해 응답한다.
// 3. 공개 페이지 HTML — JS를 실행하지 않는 공유 스크래퍼용으로 경로별 title·description·og를 넣는다.

import {
  DEFAULT_OG_IMAGE,
  ORIGIN,
  productMeta,
  ROUTE_META,
} from "./src/shared/seo/site-meta";

type Env = { ASSETS: { fetch(req: Request): Promise<Response> } };
type Product = { id: number; name: string; info: string; image: string };
type Meta = {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogType?: string;
};

const API = "https://api.essesion.com";

// 상품 API가 느리거나 죽어도 페이지는 열려야 한다 — 짧게 기다리고 실패하면 null.
async function api<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API}${path}`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char] ?? char,
  );

async function sitemap(): Promise<Response> {
  // 상품 API의 limit 상한이 100이라 끝까지 이어 받는다. 중간에 실패하면 받은 데까지만 쓴다.
  const products: Product[] = [];
  for (let offset = 0; offset < 2000; offset += 100) {
    const page = await api<Product[]>(`/products?limit=100&offset=${offset}`);
    products.push(...(page ?? []));
    if (!page || page.length < 100) break;
  }
  const paths = [
    ...Object.keys(ROUTE_META),
    ...products.map((product) => `/shop/${product.id}`),
  ];
  const urls = paths
    .map((path) => `  <url><loc>${ORIGIN}${path}</loc></url>`)
    .join("\n");
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    {
      headers: {
        "content-type": "application/xml; charset=utf-8",
        "cache-control": "public, max-age=3600",
      },
    },
  );
}

async function metaFor(pathname: string): Promise<Meta | null> {
  const path = pathname.replace(/(.)\/$/, "$1");
  if (path in ROUTE_META) {
    return { ...ROUTE_META[path as keyof typeof ROUTE_META], path };
  }
  const id = /^\/shop\/(\d+)$/.exec(path)?.[1];
  const product = id ? await api<Product>(`/products/${id}`) : null;
  return product ? productMeta(product) : null;
}

// index.html의 <!--seo--> … <!--/seo--> 사이를 바꾼다. data-seo-default는 앱이 시작할 때 걷어내는 표식이다.
function metaTags(meta: Meta): string {
  const url = meta.path === "/" ? ORIGIN : `${ORIGIN}${meta.path}`;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  return [
    `<title data-seo-default>${title}</title>`,
    `<meta data-seo-default name="description" content="${description}" />`,
    `<meta data-seo-default property="og:title" content="${title}" />`,
    `<meta data-seo-default property="og:description" content="${description}" />`,
    `<meta data-seo-default property="og:type" content="${meta.ogType ?? "website"}" />`,
    `<meta data-seo-default property="og:image" content="${escapeHtml(meta.ogImage ?? DEFAULT_OG_IMAGE)}" />`,
    `<meta data-seo-default property="og:url" content="${url}" />`,
    `<link data-seo-default rel="canonical" href="${url}" />`,
  ].join("\n    ");
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === "GET" && pathname === "/sitemap.xml") return sitemap();

    const res = await env.ASSETS.fetch(req);
    if (req.method !== "GET" || res.status !== 200) return res;

    const headers = new Headers(res.headers);
    if (headers.get("content-type")?.includes("text/html")) {
      const meta = await metaFor(pathname);
      if (!meta) return res;
      const html = (await res.text()).replace(
        /<!--seo-->[\s\S]*<!--\/seo-->/,
        () => metaTags(meta),
      );
      // 본문이 바뀌었으니 원본 기준 길이·검증자는 버린다.
      headers.delete("content-length");
      headers.delete("etag");
      return new Response(html, { status: 200, headers });
    }

    headers.set("accept-ranges", "bytes");
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
    if (!match || (!match[1] && !match[2])) {
      return new Response(res.body, { status: 200, headers });
    }

    const body = await res.arrayBuffer();
    const size = body.byteLength;
    // "N-M"·"N-"는 N부터, "-N"은 끝에서 N바이트.
    const start = match[1]
      ? Number(match[1])
      : Math.max(size - Number(match[2]), 0);
    const end =
      match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end) {
      headers.set("content-range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    headers.set("content-range", `bytes ${start}-${end}/${size}`);
    headers.set("content-length", String(end - start + 1));
    return new Response(body.slice(start, end + 1), { status: 206, headers });
  },
};
