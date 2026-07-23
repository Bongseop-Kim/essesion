import { describe, expect, it, vi } from "vitest";

import worker from "./index";

const OK_ORIGIN = "https://api-123.asia-northeast3.run.app";

function request(
  url = "https://api.essesion.com/v1/orders",
  init?: RequestInit,
) {
  return new Request(url, init);
}

describe("api-proxy edge worker", () => {
  // 신뢰 경계 — 잘못된/누락된 설정에서는 origin으로 전달하지 않고 fail-closed(503)해야 한다.
  it.each([
    ["edge secret이 없으면", { ORIGIN: OK_ORIGIN }],
    ["origin이 없으면", { EDGE_SHARED_SECRET: "s" }],
    [
      "origin이 REPLACE-ME 플레이스홀더면",
      { ORIGIN: "https://REPLACE-ME.run.app", EDGE_SHARED_SECRET: "s" },
    ],
    [
      "origin이 https가 아니면",
      {
        ORIGIN: "http://api-123.asia-northeast3.run.app",
        EDGE_SHARED_SECRET: "s",
      },
    ],
    [
      "origin이 .run.app이 아니면",
      { ORIGIN: "https://evil.example.com", EDGE_SHARED_SECRET: "s" },
    ],
    [
      "origin에 경로가 붙어 있으면",
      { ORIGIN: `${OK_ORIGIN}/nested`, EDGE_SHARED_SECRET: "s" },
    ],
  ])("%s 503으로 fail-closed한다", async (_label, env) => {
    const res = await worker.fetch(request(), env);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("origin으로 프록시하며 host를 재작성하고 신뢰 edge secret을 주입한다", async () => {
    const captured: Request[] = [];
    vi.stubGlobal("fetch", (input: Request) => {
      captured.push(input);
      return Promise.resolve(new Response("ok"));
    });
    try {
      const res = await worker.fetch(
        request("https://api.essesion.com/v1/orders", {
          // 호출자가 위조 헤더를 보내도 엣지에서 덮어써야 한다.
          headers: { "X-Essesion-Edge-Secret": "attacker-supplied" },
        }),
        { ORIGIN: OK_ORIGIN, EDGE_SHARED_SECRET: "real-secret" },
      );

      expect(res.status).toBe(200);
      expect(captured).toHaveLength(1);
      const proxied = captured[0]!;
      const url = new URL(proxied.url);
      expect(url.host).toBe("api-123.asia-northeast3.run.app");
      expect(url.pathname).toBe("/v1/orders");
      expect(proxied.headers.get("X-Essesion-Edge-Secret")).toBe("real-secret");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
