import { expect, test } from "vitest";

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
    new Request("https://essesion.shop/images/reform/reform.mp4", {
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
