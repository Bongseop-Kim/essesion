# Cloudflare 보안 규칙 — `api.essesion.shop` WAF·레이트리밋

api는 Cloudflare 프록시 뒤에만 존재하므로(직통은 403) **레이트리밋과 봇 차단의 유일한 지점이 edge다.**
api 앱 안에는 사용자별 제한만 있고 IP 기준 제한이 없다. 대시보드 작업이라 IaC로 못 넣는다.

대상: zone `essesion.shop`, 호스트 `api.essesion.shop` (Worker `essesion-api-proxy`, custom domain).

## 0. 먼저 확인할 것

zone의 **요금제**를 본다. 무료 플랜은 레이트리밋 규칙 수가 제한적이라 아래를 다 만들지 못할 수 있다.
못 만들면 이 문서의 우선순위 순서대로 위에서부터 적용하고, 무엇을 못 넣었는지 기록에 남긴다.

## 1. 레이트리밋 규칙 (우선순위 순)

| # | 대상 | 한도 | 이유 |
|---|---|---|---|
| 1 | `POST /auth/login`, `POST /auth/phone/verify` | IP당 10req/min | 크리덴셜 스터핑·SMS 비용 폭탄 |
| 2 | `POST /payments/webhook` | IP당 60req/min | Toss IP 외 유입 차단. 정상 웹훅량보다 훨씬 크게 |
| 3 | `POST /images/reform-upload-url` | IP당 60req/hour | **익명** 수선 이미지 업로드 — 인증이 없어 GCS 비용에 직결 |
| 4 | `POST /design/ideas` | IP당 30req/min | 무과금 helper. api의 사용자별 6회/60초와 별개로 IP 단위 |
| 5 | 전체 `api.essesion.shop/*` | IP당 100req/min | 최종 안전망 |

- 동작은 **Block**, 기간은 기본값(1분)으로 시작한다. 429 응답은 store가 재시도하지 않는다.
- 3번은 다른 것과 달리 **시간 단위**다. 분 단위로 넣으면 의미가 없다.

## 2. 관리형 WAF

`api.essesion.shop`에 Cloudflare Managed Ruleset을 켠다. 켠 직후 **정상 요청이 막히지 않는지**
확인할 것 — 특히 이미지 업로드(PUT)와 결제 웹훅의 JSON 페이로드.

Toss 웹훅이 WAF에 걸리면 결제 상태가 내부와 어긋난다. 웹훅 경로는 규칙 예외(skip)를 두는 편이 안전하다.

## 3. 넣지 않는 것

- **국가 차단**: 하지 않는다. 해외 결제·소셜 로그인 콜백이 막힌다.
- **Bot Fight Mode**: 하지 않는다. `POST /payments/webhook`과 OAuth 콜백이 챌린지에 걸린다.
- `app.`·`admin.`: 정적 자산이라 별도 규칙을 두지 않는다. admin은 로그인 자체가 api를 거치므로 1번 규칙이 덮는다.

## 검증

```bash
# 1번 규칙 — 11번째 요청이 429여야 한다
for i in $(seq 1 11); do
  curl -s -o /dev/null -w '%{http_code} ' -X POST https://api.essesion.shop/auth/login \
    -H 'content-type: application/json' -d '{"email":"x@x.com","password":"wrong"}'
done; echo
```

WAF를 켠 뒤에는 실제 Toss sandbox 결제 1건과 이미지 업로드 1건을 통과시켜 오탐이 없는지 확인한다
(OPERATOR-CHECKLIST E2와 함께 수행).

## 완료 시

`docs/OPERATOR-CHECKLIST.md` A5의 "WAF·레이트리밋 설정"을 체크하고, 적용한 규칙과 **적용하지 못한
규칙**을 이 문서 대신 `docs/reviews/`에 기록으로 남긴다.
