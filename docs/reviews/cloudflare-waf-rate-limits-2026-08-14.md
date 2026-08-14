# Cloudflare edge WAF·레이트리밋 — 도입하지 않음 (2026-08-14)

`docs/plans/cloudflare-waf-rate-limits.md` 플랜을 실행 전 검토하고 **폐기**했다. 플랜의 전제가
틀렸고, 남는 실이익이 Free→Business 업그레이드 비용을 정당화하지 못한다.

## 틀린 전제

플랜은 "api 앱 안에는 사용자별 제한만 있고 IP 기준 제한이 없다"를 근거로 edge를 유일한 방어
지점으로 봤다. 실제로는 api에 리미터 5개가 이미 돌고 있고 그중 3개가 IP 기준이다
(`apps/api/src/api/domains/auth/rate_limit.py`, 인스턴스는 `api/main.py:238-266`).

| 리미터 | 라우트 | 키 | 한도 |
|---|---|---|---|
| `store_auth_rate_limiter` | `POST /auth/login` | IP | 10 / 60s |
| `admin_auth_rate_limiter` | `POST /auth/admin/login`, `/auth/admin/refresh` | IP | 10 / 60s |
| `toss_webhook_rate_limiter` | `POST /payments/webhook` | IP | 300 / 60s |
| `phone_verify_rate_limiter` | `POST /auth/phone/verify` | user_id | 20 / 60s |
| `design_ideas_rate_limiter` | `POST /design/ideas` | user_id | 6 / 60s |

IP는 `request_client_ip()`가 `X-Essesion-Edge-Secret`을 HMAC 비교로 검증한 뒤에만
`CF-Connecting-IP`를 신뢰한다 — 헤더 위조 우회 불가.

플랜이 요구한 5개 규칙 중 **1·2·4번이 이미 같은 값으로 구현**돼 있었다.

## 플랜의 나머지 규칙도 불필요

- `/auth/phone/verify`는 SMS를 보내지 않는다(코드 검증만). 발송하는 `/auth/phone/send`는 인증
  필수 + 공개 회원가입 없음이고, DB 기준 1분 재전송 쿨다운 + 일일 한도가 있다(`auth/phone.py:54,63`).
  → SMS 비용 폭탄 경로가 애초에 없다.
- AI 생성 요청은 토큰 과금이라 쓴 만큼만 나가고, OpenAI 계정 자체에 지출 한도가 걸려 있다.
  → 악용해도 상한이 이중으로 막힌다. 플랜의 비용 방어 논거 대부분이 여기서 사라진다.
- `POST /images/reform-upload-url`은 `OptionalUser`라 익명 발급이 가능하지만(`images/router.py:253`),
  `max_size_bytes` 상한 + `expires_at` TTL + `POST /batch/cleanup-images` 청소가 걸려 있어 최악이
  "만료 전까지 쌓이는 GCS 저장 비용" 수준이다. 문제가 되면 기존 `AuthRateLimiter`를 이 라우트에
  재사용하면 끝 — Cloudflare를 건드릴 이유가 없다.
- 전체 100req/min 안전망은 Cloud Run max instances가 실질 상한으로 대체한다.

## 플랜은 Free에서 실행 자체가 불가능했다

zone `essesion.shop`은 **Free**(`plan.legacy_id: free`, 2026-08-14 API 확인). 레이트리밋 규칙의
플랜별 한도:

| | 규칙 수 | 최대 기간 | 차단 시간 | 표현식 필드 |
|---|---|---|---|---|
| **Free** | 1 | 10초만 | 10초만 | Path, Verified Bot |
| Pro ($20/mo) | 2 | 1분 | 1시간 | +Host, URI, Query |
| Business ($200/mo) | 5 | 10분 | 1일 | +Method, Source IP, UA |
| Enterprise | 100 | ~18시간 | 1일 | 전부 |

- 규칙 5개 → Business부터. `POST` 메서드 매칭 → Business부터(Free/Pro는 경로만).
- 플랜 3번의 **60req/hour** → Business의 10분도 부족, Enterprise 전용.
- 관리형 WAF: Cloudflare Managed Ruleset은 Pro+. Free는 Free Managed Ruleset(고위험 CVE만)이
  **이미 자동 배포**돼 있어 켤 것이 없다. 따라서 Toss 웹훅 WAF 오탐 우려도 대부분 무의미.

즉 원안은 최소 Business, 3번은 Enterprise가 필요했다.

## 검토했지만 쓰지 않은 대안

Workers **Rate Limiting 바인딩**(`ratelimits` in `wrangler.jsonc`) — `api-proxy`가 이미 api 앞단
전부를 지나므로 플랜 업그레이드 없이 IaC로 넣을 수 있고 경로·메서드도 코드로 매칭된다. 채택하지
않은 이유: api 내장 리미터가 같은 한도를 이미 강제하고 있어 **중복**이다. 카운터가 colo 단위라
전역 정확도도 인스턴스 단위인 지금보다 확실히 낫지 않다. api 리미터를 공유 카운터로 올려야 할
때가 오면 이 바인딩보다 Redis/Postgres 쪽이 정확하다.

## 남는 실제 갭 (지금은 수용)

api 리미터는 in-memory라 **Cloud Run 인스턴스 단위**다. 인스턴스가 N개면 유효 한도가 N배.
계정이 시드·관리자로만 생성돼 크리덴셜 스터핑 표면적이 작으니 현재는 무해하다.
**공개 회원가입을 열거나 인스턴스가 상시 2개 이상이 되면** 공유 카운터로 전환할 것
(`rate_limit.py` 상단 `ponytail:` 주석에 동일 내용).

## 함께 고친 문서·주석

플랜과 같은 틀린 전제를 반복하던 곳들:

- `docs/CHECKLIST.md` — "Cloudflare 보안 규칙" 항목 삭제
- `docs/OPERATOR-CHECKLIST.md` A5 — "WAF·레이트리밋 설정" → 프록시 배포만
- `infra/README.md` 선개통 4단계 — 대시보드 규칙 표 삭제
- `infra/cloudflare/README.md` — `api-proxy`가 "WAF·레이트리밋·봇 차단" 담당이라는 서술 정정
- `infra/cloudflare/api-proxy/src/index.ts`, `apps/api/.../auth/rate_limit.py` — 헤더 주석 정정
