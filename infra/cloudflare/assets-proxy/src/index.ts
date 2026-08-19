// assets.<domain> → 공개 GCS assets 버킷 캐시 프록시 (docs/reviews/perf-cost-reduction-2026-08-19.md 7번)
// storage.googleapis.com 직통 서빙은 조회 1건마다 서울 리전 egress + Class B 오퍼레이션 +
// DATA_READ 감사 로그(Cloud Logging 1건)가 붙는다 — Cloudflare 캐시 적중으로 셋을 동시에 없앤다.
// 객체 키가 content-hash라(같은 키 = 같은 내용) immutable 캐시가 안전하다.

const YEAR_SECONDS = 31536000;

export default {
  // BUCKET은 wrangler.jsonc vars의 고정 리터럴이다 — 배포 시 주입되는 api-proxy의 ORIGIN과
  // 달리 누락·오타가 런타임 변수로 들어올 수 없어 설정 검증을 두지 않는다.
  async fetch(req: Request, env: { BUCKET: string }): Promise<Response> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }
    const url = new URL(req.url);
    // 쿼리는 버린다 — 공개 객체 조회에 쿼리 시맨틱이 없고, 남기면 캐시 키만 쪼갠다.
    const origin = `https://storage.googleapis.com/${env.BUCKET}${url.pathname}`;
    const upstream = await fetch(
      new Request(origin, { method: req.method }),
      // cf는 Cloudflare 런타임 전용 fetch 옵션 — 표준 RequestInit 타입에 없다.
      {
        cf: {
          cacheEverything: true,
          cacheTtlByStatus: {
            "200-299": YEAR_SECONDS,
            "404": 60,
            "500-599": 0,
          },
        },
      } as RequestInit,
    );
    if (!upstream.ok) {
      return upstream;
    }
    const headers = new Headers(upstream.headers);
    headers.set("cache-control", `public, max-age=${YEAR_SECONDS}, immutable`);
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
