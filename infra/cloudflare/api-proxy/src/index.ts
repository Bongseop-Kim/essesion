// api.<domain> → Cloud Run api 프록시 (ARCHITECTURE §2)
// WAF·레이트리밋·봇 차단은 Cloudflare 대시보드 규칙이 담당 — 여기는 origin 전달만.
export default {
  async fetch(
    req: Request,
    env: { ORIGIN: string; EDGE_SHARED_SECRET?: string },
  ): Promise<Response> {
    if (!env.EDGE_SHARED_SECRET) {
      return Response.json(
        {
          detail: "API proxy secret is unavailable",
          code: "service_unavailable",
        },
        { status: 503 },
      );
    }
    const url = new URL(req.url);
    const origin = new URL(env.ORIGIN);
    url.protocol = origin.protocol;
    url.host = origin.host;
    const headers = new Headers(req.headers);
    // Ignore any caller-supplied value and replace it at the trusted edge.
    headers.set("X-Essesion-Edge-Secret", env.EDGE_SHARED_SECRET);
    const proxied = new Request(url, req);
    return fetch(new Request(proxied, { headers }));
  },
};
