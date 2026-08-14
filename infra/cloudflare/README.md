# Cloudflare — 서브도메인 + api 프록시

**도메인 확정: `essesion.shop`.**

| 서브도메인 | 대상 | 방식 |
|---|---|---|
| `app.essesion.shop` | `apps/store` | wrangler custom domain (`wrangler.jsonc`에 고정) |
| `admin.essesion.shop` | `apps/admin` | 동일 |
| `api.essesion.shop` | Cloud Run api | **`api-proxy` 워커** — WAF·레이트리밋·봇 차단·DDoS 방어 |

`api-proxy`(`api-proxy/src/index.ts`)는 요청에 `EDGE_SHARED_SECRET` 헤더를 덮어써서 Cloud Run
origin으로 넘긴다. 비로컬 api는 일반 HTTP 전체에서 이 헤더를 검사하므로 `run.app` 직접 호출과
시크릿 없는 프록시 배포는 fail closed다. `edge-proxy-secret`에 버전이 **없으면** 503이 아니라
api 리비전 자체가 기동 실패한다(`cloudrun.tf`가 `version="latest"`로 참조).

바인딩: `ORIGIN`(배포 시 `--var`로 주입, 파일에 저장하지 않음) · `EDGE_SHARED_SECRET`(wrangler secret).

> 개통 순서와 명령은 [infra/README.md](../README.md#cloudflare--api-프록시-선개통)가 정본이다.
