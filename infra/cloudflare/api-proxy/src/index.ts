// api.<domain> → Cloud Run api 프록시 (ARCHITECTURE §1)
// 여기가 하는 일은 origin 전달과 신뢰 헤더 주입(edge secret·접속 호스트, 호출자 값은 덮어쓴다)뿐이다.
// 레이트리밋은 api 내장 리미터가 담당하고 edge 규칙은 두지 않는다.
// (근거: docs/reviews/cloudflare-waf-rate-limits-2026-08-14.md)
export default {
  async fetch(
    req: Request,
    env: { ORIGIN?: string; EDGE_SHARED_SECRET?: string },
  ): Promise<Response> {
    let origin: URL | null = null;
    try {
      origin = env.ORIGIN ? new URL(env.ORIGIN) : null;
    } catch {
      // Invalid config is handled by the same fail-closed response below.
    }
    const normalizedOrigin = env.ORIGIN?.endsWith("/")
      ? env.ORIGIN.slice(0, -1)
      : env.ORIGIN;
    if (
      !env.EDGE_SHARED_SECRET ||
      !env.ORIGIN ||
      env.ORIGIN.includes("REPLACE-ME") ||
      !origin ||
      origin.protocol !== "https:" ||
      !origin.hostname.endsWith(".run.app") ||
      normalizedOrigin !== origin.origin
    ) {
      return Response.json(
        {
          detail: "API proxy configuration is unavailable",
          code: "service_unavailable",
        },
        { status: 503 },
      );
    }
    const url = new URL(req.url);
    url.protocol = origin.protocol;
    url.host = origin.host;
    const headers = new Headers(req.headers);
    // Ignore any caller-supplied value and replace it at the trusted edge.
    headers.set("X-Essesion-Edge-Secret", env.EDGE_SHARED_SECRET);
    // url.host를 run.app으로 바꾸면 접속한 공개 호스트가 사라진다. api가 허용 목록에서
    // 사이트 쌍(api ↔ 프론트)을 고를 수 있게 같은 신뢰 경계에서 덮어써 넘긴다.
    headers.set("X-Essesion-Forwarded-Host", new URL(req.url).host);
    const proxied = new Request(url, req);
    return fetch(new Request(proxied, { headers }));
  },
};
