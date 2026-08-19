# Cloudflare — 서브도메인 + api 프록시

**도메인 확정: `essesion.shop`.**

| 서브도메인 | 대상 | 방식 |
|---|---|---|
| `app.essesion.shop` | `apps/store` | wrangler custom domain (`wrangler.jsonc`에 고정) |
| `admin.essesion.shop` | `apps/admin` | 동일 |
| `api.essesion.shop` | Cloud Run api | **`api-proxy` 워커** — origin 전달 + edge secret 주입, Cloudflare 기본 DDoS 방어 |
| `assets.essesion.shop` | GCS 공개 assets 버킷 | **`assets-proxy` 워커** — Cloudflare 캐시(immutable, content-hash 키 전제)로 GCS egress·Class B·DATA_READ 로그 절감 |

`api-proxy`(`api-proxy/src/index.ts`)는 요청에 `EDGE_SHARED_SECRET` 헤더를 덮어써서 Cloud Run
origin으로 넘긴다. 비로컬 api는 일반 HTTP 전체에서 이 헤더를 검사하므로 `run.app` 직접 호출과
시크릿 없는 프록시 배포는 fail closed다. `edge-proxy-secret`에 버전이 **없으면** 503이 아니라
api 리비전 자체가 기동 실패한다(`cloudrun.tf`가 `version="latest"`로 참조).

바인딩: `ORIGIN`(배포 시 `--var`로 주입, 파일에 저장하지 않음) · `EDGE_SHARED_SECRET`(wrangler secret).

`assets-proxy`(`assets-proxy/src/index.ts`)는 GET/HEAD만 받아 `storage.googleapis.com/<BUCKET>`으로
프록시하고 1년 immutable로 캐시한다(객체 키가 content-hash라 안전). `BUCKET`은 시크릿이 아니고
고정값이라 wrangler.jsonc `vars`에 둔다. **개통 순서**: ① 배포로 custom domain이 살아난 것 확인
(`curl -I https://assets.essesion.shop/<존재하는 키>` → 200 + `cf-cache-status`) → ② api env
`PUBLIC_ASSETS_ORIGIN=https://assets.essesion.shop`을 `production.tfvars`의 `api_extra_env`에 넣고
tofu apply. 순서를 어기면 api가 죽은 호스트로 URL을 발급한다. 프록시 도입 전 DB에 저장된
직통 URL(상품 이미지)은 계속 동작한다 — 버킷 공개 읽기는 유지되므로 깨지지 않는다.

> 개통 순서와 명령은 [infra/README.md](../README.md#cloudflare--api-프록시-선개통)가 정본이다.
