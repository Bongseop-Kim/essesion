# Cloudflare — 서브도메인 + api 프록시

**도메인 확정: `essesion.shop`.** `api.essesion.shop` 프록시는 첫 비로컬 API
리비전보다 먼저 개통한다. `app.`·`admin.` 정적 프론트 route는 5단계 프론트
배포 때 이어서 연결한다.

## 구성 (ARCHITECTURE §2)

| 서브도메인 | 대상 | 방식 |
|---|---|---|
| `app.essesion.shop` | `apps/store` | wrangler custom domain (`wrangler.jsonc`에 고정) |
| `admin.essesion.shop` | `apps/admin` | 동일 |
| `api.essesion.shop` | Cloud Run api | **`api-proxy` 워커** — Cloudflare 프록시 경유로 WAF·레이트리밋·봇 차단·DDoS 방어 확보 |

api-proxy를 쓰는 이유: 프록시된 CNAME→run.app은 Host 불일치로 불가, Host 재작성은 Enterprise 전용, LB는 비용. 워커 프록시가 무료 플랜에서 동작하는 가장 단순한 경로다.

## 최초 API 개통 순서

1. Cloudflare에 `essesion.shop` zone 추가(네임서버 이전).
2. `infra/README.md` 절차로 생성한 Secret Manager `edge-proxy-secret` 최신 버전을 `gcloud secrets versions access latest --secret=edge-proxy-secret --project=essesion-staging | pnpm -C infra/cloudflare/api-proxy exec wrangler secret put EDGE_SHARED_SECRET`로 주입한다. 값을 파일·셸 기록·커밋에 남기지 않는다.
3. `api.essesion.shop/*` route는 `api-proxy/wrangler.jsonc`에 고정돼 있다. `tofu -chdir=infra apply` 후 Cloud Run URL을 파일에 저장하지 말고 배포 시 `ORIGIN`으로 주입한다.
4. 첫 API 이미지 배포 전에 `pnpm -C infra/cloudflare/api-proxy exec wrangler deploy --var "ORIGIN:$(tofu -chdir=infra output -raw api_url)"`로 프록시를 선배포한다. 이후 deploy workflow는 Cloud Run이 반환한 서비스 URL을 검증해 동일하게 주입한다.
5. 대시보드 Security 규칙: `api.essesion.shop`에 기본 레이트리밋 1개(예: IP당 100req/min) + 관리형 WAF를 켠다. `POST /auth/login`, `POST /auth/phone/verify`, `POST /payments/webhook`은 별도 IP 한도를 두고, 익명 수선 이미지 발급 `POST /images/reform-upload-url`에는 IP당 60req/hour 규칙을 둔다. 무과금 helper인 `POST /design/ideas`도 API 인스턴스의 사용자별 6회/60초 제한과 별개로 IP 한도를 둔다.
6. API 배포 후 `curl -fsS 'https://api.essesion.shop/readyz'`가 200인지 확인한다. 이어 동일한 일반 요청을 공개 프록시와 직통 origin에 각각 보낸다. `curl -fsS 'https://api.essesion.shop/products?limit=1'`은 200, `curl -sS -o /dev/null -w '%{http_code}' "$(tofu -chdir=infra output -raw api_url)/products?limit=1"`은 403이어야 한다. `run.app` 직통 `/readyz`도 exact edge header 없이 403이며, `/healthz`와 Google OIDC를 별도로 검증하는 `/batch/*`만 전역 edge 검사를 우회한다.
7. Toss 웹훅과 Google·Kakao redirect URI는 처음부터 `https://api.essesion.shop` 기준으로만 등록한다. Cloud Run `run.app` URL을 외부 콘솔에 등록하지 않는다.
8. 5단계 프론트 배포 뒤 `apps/store`·`apps/admin`의 고정 custom-domain route가 연결됐는지 확인한다. 생성물 이미지 서빙 도메인(GCS 프록시 캐시)은 worker GCS 연결 때 별도로 구성한다.

비로컬 API는 일반 HTTP 전체에서 정확히 하나의 공유 헤더를 필수로 검사한다.
따라서 `run.app` 직접 호출과 시크릿이 없는 프록시 배포는 fail closed이고,
Secret Manager 값이 없으면 공개 `https://api.essesion.shop/readyz`가 `edge_proxy=unavailable`로 503을 반환한다.
