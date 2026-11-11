// Workers 정적 자산은 Range 요청에도 200 + 전체 파일을 돌려준다(Accept-Ranges 없음).
// 영상은 일시정지 후 이어받기·반복 재생·Safari 재생에 206이 필요하므로, mp4만 Worker가 먼저 받아
// 정적 자산 응답을 잘라 준다 (wrangler.jsonc run_worker_first).
// ponytail: 파일 전체를 메모리에 올려 자른다 — 영상이 수 MB를 넘기면 R2 등 Range를 지원하는 저장소로 옮긴다.

type Env = { ASSETS: { fetch(req: Request): Promise<Response> } };

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await env.ASSETS.fetch(req);
    if (req.method !== "GET" || res.status !== 200) return res;

    const headers = new Headers(res.headers);
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
