# Cloudflare — 서브도메인 + api 프록시

**도메인 확정: `essesion.shop`.** zone·routes 연결 전까지는 workers.dev URL로 동작 — 연결은 5단계(프론트 배포) 시 아래 수동 단계 수행.

## 구성 (ARCHITECTURE §2)

| 서브도메인 | 대상 | 방식 |
|---|---|---|
| `app.essesion.shop` | `apps/store` | wrangler custom domain (`wrangler.jsonc`의 routes 주석 해제) |
| `admin.essesion.shop` | `apps/admin` | 동일 |
| `api.essesion.shop` | Cloud Run api | **`api-proxy` 워커** — Cloudflare 프록시 경유로 WAF·레이트리밋·봇 차단·DDoS 방어 확보 |

api-proxy를 쓰는 이유: 프록시된 CNAME→run.app은 Host 불일치로 불가, Host 재작성은 Enterprise 전용, LB는 비용. 워커 프록시가 무료 플랜에서 동작하는 가장 단순한 경로다.

## zone 연결 수동 단계 (5단계 시)

1. Cloudflare에 `essesion.shop` zone 추가(네임서버 이전).
2. `apps/store`·`apps/admin`·`api-proxy`의 `wrangler.jsonc` routes 주석 해제 + `api-proxy`의 `ORIGIN`을 `tofu output api_url` 값으로 교체.
3. 대시보드 Security 규칙: api.essesion.shop에 기본 레이트리밋 1개(예: IP당 100req/min) + 관리형 WAF를 켠다. 익명 수선 이미지 발급 `POST /images/reform-upload-url`에는 IP당 60req/hour 규칙을 별도로 둔다.
4. Google·Kakao 등 프로바이더 콘솔에 redirect URI 등록(체크리스트 0단계에서 준비됨).
5. 생성물 이미지 서빙 도메인(GCS 프록시 캐시)은 4단계(worker) GCS 연결 시 구성.
