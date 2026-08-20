import { afterEach, describe, expect, it, vi } from "vitest";

import worker from "./index";

const BUCKET = "ysindustry-assets";

function request(
  url = "https://assets.essesion.shop/fabric/abc123.png",
  init?: RequestInit,
) {
  return new Request(url, init);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("assets-proxy edge worker", () => {
  it("GET/HEAD 외 메서드는 origin에 닿지 않고 405", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await worker.fetch(request(undefined, { method: "POST" }), {
      BUCKET,
    });
    expect(res.status).toBe(405);
    expect(res.headers.get("allow")).toBe("GET, HEAD");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("경로를 버킷 뒤에 붙여 GCS로 프록시하고 쿼리는 버린다", async () => {
    let proxied: Request | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (req: Request) => {
        proxied = req;
        return new Response("png-bytes", {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }),
    );
    const res = await worker.fetch(
      request("https://assets.essesion.shop/fabric/abc123.png?x=1"),
      { BUCKET },
    );
    expect(proxied?.url).toBe(
      `https://storage.googleapis.com/${BUCKET}/fabric/abc123.png`,
    );
    expect(res.status).toBe(200);
    // content-hash 키 전제의 브라우저 캐시 계약
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("content-type")).toBe("image/png");
  });

  it("origin 실패(404)는 immutable 캐시 헤더 없이 그대로 통과시킨다", async () => {
    const upstream = new Response("not found", { status: 404 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => upstream),
    );
    const res = await worker.fetch(request(), { BUCKET });
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBeNull();
  });
});
