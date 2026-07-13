# Cloudflare — 서브도메인 + api 프록시

**도메인 확정: `essesion.shop`.** `api.essesion.shop` 프록시는 첫 비로컬 API
리비전보다 먼저 개통한다. `app.`·`admin.` 정적 프론트 route는 5단계 프론트
배포 때 이어서 연결한다.

## 구성 (ARCHITECTURE §2)

| 서브도메인 | 대상 | 방식 |
|---|---|---|
| `app.essesion.shop` | `apps/store` | wrangler custom domain (`wrangler.jsonc`의 routes 주석 해제) |
| `admin.essesion.shop` | `apps/admin` | 동일 |
| `api.essesion.shop` | Cloud Run api | **`api-proxy` 워커** — Cloudflare 프록시 경유로 WAF·레이트리밋·봇 차단·DDoS 방어 확보 |

api-proxy를 쓰는 이유: 프록시된 CNAME→run.app은 Host 불일치로 불가, Host 재작성은 Enterprise 전용, LB는 비용. 워커 프록시가 무료 플랜에서 동작하는 가장 단순한 경로다.

## 최초 API 개통 순서

1. Cloudflare에 `essesion.shop` zone 추가(네임서버 이전).
2. `openssl rand -base64 32` 등으로 공유값을 한 번 생성한다. 같은 값을 Secret Manager `edge-proxy-secret` 최신 버전과 `pnpm -C infra/cloudflare/api-proxy exec wrangler secret put EDGE_SHARED_SECRET`에 각각 주입한다. 값은 파일·셸 기록·커밋에 남기지 않는다.
3. `tofu apply` 후 `api-proxy/wrangler.jsonc`의 `ORIGIN`을 `tofu output -raw api_url` 값으로 바꾸고 `api.essesion.shop/*` route만 먼저 활성화한다.
4. 첫 API 이미지 배포 전에 `pnpm -C infra/cloudflare/api-proxy exec wrangler deploy`로 프록시를 배포한다. 이후 일반 deploy workflow는 Cloud Run 성공 뒤 같은 프록시를 다시 배포해도 안전하다.
5. 대시보드 Security 규칙: `api.essesion.shop`에 기본 레이트리밋 1개(예: IP당 100req/min) + 관리형 WAF를 켠다. `POST /auth/login`, `POST /auth/phone/verify`, `POST /payments/webhook`은 별도 IP 한도를 두고, 익명 수선 이미지 발급 `POST /images/reform-upload-url`에는 IP당 60req/hour 규칙을 둔다.
6. API 배포 후 `https://api.essesion.shop/healthz`가 200인지 확인한다. Cloud Run URL의 `POST /auth/login`은 secret 없이 403이어야 하고 `/healthz`, `/readyz`, `/batch/*`만 전역 edge 검사를 우회한다(`/batch/*`는 별도 Google OIDC 검증).
7. Toss 웹훅과 Google·Kakao redirect URI는 처음부터 `https://api.essesion.shop` 기준으로만 등록한다. Cloud Run `run.app` URL을 외부 콘솔에 등록하지 않는다.
8. 5단계 프론트 배포 때 `apps/store`·`apps/admin` route를 활성화한다. 생성물 이미지 서빙 도메인(GCS 프록시 캐시)은 worker GCS 연결 때 별도로 구성한다.

비로컬 API는 일반 HTTP 전체에서 정확히 하나의 공유 헤더를 필수로 검사한다.
따라서 `run.app` 직접 호출과 시크릿이 없는 프록시 배포는 fail closed이고,
Secret Manager 값이 없으면 `/readyz`가 `edge_proxy=unavailable`로 503을 반환한다.
