// api.<domain> → Cloud Run api 프록시 (ARCHITECTURE §2)
// WAF·레이트리밋·봇 차단은 Cloudflare 대시보드 규칙이 담당 — 여기는 origin 전달만.
export default {
  async fetch(req: Request, env: { ORIGIN: string }): Promise<Response> {
    const url = new URL(req.url);
    const origin = new URL(env.ORIGIN);
    url.protocol = origin.protocol;
    url.host = origin.host;
    return fetch(new Request(url, req));
  },
};
