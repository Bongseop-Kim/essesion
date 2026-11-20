import { afterEach, expect, test, vi } from "vitest";

import worker from "./worker";

const FILE = new TextEncoder().encode("0123456789");
const env = {
  ASSETS: {
    fetch: async () =>
      new Response(FILE, { headers: { "content-type": "video/mp4" } }),
  },
};

async function get(range?: string) {
  const res = await worker.fetch(
    new Request("https://essesion.com/images/reform/reform.mp4", {
      headers: range ? { range } : {},
    }),
    env,
  );
  return {
    status: res.status,
    range: res.headers.get("content-range"),
    text: await res.text(),
  };
}

test("Range 요청을 206 부분 응답으로 자른다", async () => {
  expect(await get("bytes=2-5")).toEqual({
    status: 206,
    range: "bytes 2-5/10",
    text: "2345",
  });
  expect(await get("bytes=7-")).toMatchObject({
    range: "bytes 7-9/10",
    text: "789",
  });
  expect(await get("bytes=-3")).toMatchObject({
    range: "bytes 7-9/10",
    text: "789",
  });
  expect(await get("bytes=0-999")).toMatchObject({ range: "bytes 0-9/10" });
});

test("Range가 없으면 전체를, 범위를 벗어나면 416을 돌려준다", async () => {
  expect(await get()).toMatchObject({ status: 200, text: "0123456789" });
  expect(await get("bytes=20-30")).toMatchObject({
    status: 416,
    range: "bytes */10",
  });
});

const INDEX_HTML = `<head><!--seo--><title data-seo-default>기본</title><!--/seo--><meta property="og:site_name" content="영선산업" /></head>`;
const htmlEnv = {
  ASSETS: {
    fetch: async () =>
      new Response(INDEX_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  },
};
const page = async (path: string) =>
  (
    await worker.fetch(new Request(`https://essesion.com${path}`), htmlEnv)
  ).text();

function stubApi(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal("fetch", async (url: string) => handler(url));
}
afterEach(() => vi.unstubAllGlobals());

test("공개 페이지 HTML에 경로별 메타를 넣는다", async () => {
  const html = await page("/faq");
  expect(html).toContain(
    "<title data-seo-default>자주 묻는 질문 | 영선산업</title>",
  );
  expect(html).toContain('rel="canonical" href="https://essesion.com/faq"');
  expect(html).not.toContain("기본");
  expect(html).toContain("og:site_name");
});

test("상품 상세는 상품 API의 이름·이미지를 넣고 값을 이스케이프한다", async () => {
  stubApi((url) => {
    expect(url).toBe("https://api.essesion.com/products/7");
    return Response.json({
      id: 7,
      name: 'A&B "타이"',
      info: "설명 <b>",
      image: "https://assets.essesion.com/p.png",
    });
  });
  const html = await page("/shop/7");
  expect(html).toContain(
    "<title data-seo-default>A&amp;B &quot;타이&quot; | 영선산업</title>",
  );
  expect(html).toContain('name="description" content="설명 &lt;b&gt;"');
  expect(html).toContain(
    'og:image" content="https://assets.essesion.com/p.png"',
  );
  expect(html).toContain('og:type" content="product"');
});

test("상품 API가 실패하거나 모르는 경로면 원본 HTML을 그대로 준다", async () => {
  stubApi(() => {
    throw new Error("timeout");
  });
  expect(await page("/shop/7")).toBe(INDEX_HTML);
  expect(await page("/cart")).toBe(INDEX_HTML);
});

test("사이트맵은 고정 주소에 상품 주소를 더하고, API가 실패하면 고정 주소만 준다", async () => {
  stubApi(() => Response.json([{ id: 3 }, { id: 9 }]));
  const xml = await page("/sitemap.xml");
  expect(xml).toContain("<loc>https://essesion.com/</loc>");
  expect(xml).toContain("<loc>https://essesion.com/design</loc>");
  expect(xml).toContain("<loc>https://essesion.com/shop/9</loc>");

  stubApi(() => new Response("down", { status: 503 }));
  const fallback = await page("/sitemap.xml");
  expect(fallback).toContain("<loc>https://essesion.com/shop</loc>");
  expect(fallback).not.toContain("/shop/");
});
