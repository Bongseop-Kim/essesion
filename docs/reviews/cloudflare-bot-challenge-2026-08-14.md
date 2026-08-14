# Bot Fight Mode가 deploy 게이트와 Toss 웹훅을 막았다 — OFF (2026-08-14)

첫 production deploy(run 31786528410)가 마지막 `Verify public proxy and direct-origin boundary`
스텝에서만 실패했다. 배포 자체는 전부 성공한 상태였다 — migrate job Completed, Cloud Run
api/worker-generate/worker-finalize 전원 Ready, Cloudflare workers 3종 배포 완료.

## 증상

CI가 받은 응답은 앱의 에러가 아니라 Cloudflare의 챌린지 인터스티셜이었다.

```
Public API readiness failed with HTTP 403
<!DOCTYPE html>...<title>Just a moment...</title>... challenges.cloudflare.com ...
```

같은 시각 운영자 단말(가정용 IP)에서는 정상이었다.

| 요청 | 결과 |
|---|---|
| `https://api.essesion.shop/readyz` (가정용 IP) | 200, capability 전원 `ready/real/oidc` |
| `https://api.essesion.shop/readyz` (GitHub Actions 러너) | **403 challenge** |
| `https://api-ryessxc2ba-du.a.run.app/readyz` 직통 | 403 (엣지 경계 정상 동작) |

UA가 아니라 **IP/ASN 기준**이었다 — 단말의 curl도 브라우저 UA가 아닌데 200이었고, 러너만
Azure 데이터센터 IP라 걸렸다.

## 원인

zone `essesion.shop`(Free)에 **Bot Fight Mode가 ON**이었다(Security → Settings → Bot traffic,
JS Detections: On). BFM은 데이터센터 ASN 등 "자동화로 보이는" 트래픽에 managed challenge를 던진다.

## CI만의 문제가 아니었다

이게 이 건의 핵심이다. 같은 챌린지는 데이터센터에서 오는 **모든 server-to-server 호출**에 걸린다:

- **Toss 웹훅** `POST /payments/webhook` — 결제 통지가 조용히 403. 돈 경로다.
- Solapi 콜백.

즉 OPERATOR-CHECKLIST B-5(외부 콘솔 등록) 전에 반드시 풀어야 하는 선행 조건이었다.
CI 검증 스텝이 이걸 먼저 밟아준 셈이다.

## 왜 예외 처리가 아니라 OFF인가

Free의 BFM은 **호스트별 예외가 원천 불가**다. 룰셋 엔진 밖의 별도 평가 파이프라인에서 돌기 때문에
WAF custom rule의 *Skip*·*Bypass*·*Allow*도, Page Rules도 먹지 않는다. 예외가 필요하면
Super Bot Fight Mode(Pro+) 또는 Bot Management(Enterprise)로 올라가야 한다
([Cloudflare 문서](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/)).

`api.essesion.shop`은 기계 대 기계 API 호스트다. 봇 휴리스틱이 구조적으로 틀리는 자리이므로
플랜 업그레이드가 아니라 **존 전체 OFF**를 택했다.

## OFF해도 방어가 비지 않는다

[cloudflare-waf-rate-limits-2026-08-14](./cloudflare-waf-rate-limits-2026-08-14.md)가 정리한 대로
api에 리미터 5개가 이미 돌고 그중 3개가 IP 기준이다(`apps/api/src/api/domains/auth/rate_limit.py`).
IP는 `request_client_ip()`가 `X-Essesion-Edge-Secret`을 HMAC 비교로 검증한 뒤에만
`CF-Connecting-IP`를 신뢰하므로 헤더 위조 우회도 불가하다. Free Managed Ruleset(고위험 CVE)은
BFM과 무관하게 유지된다. 두 문서를 함께 읽으면 **엣지에는 규칙을 두지 않고 api 내장 리미터가
담당한다**는 결론이 일관된다.

## 결과

Bot Fight Mode OFF → `gh run rerun 31786528410 --failed` → backend·frontend 양쪽 success.
검증 스텝이 공개 `/readyz` 200 → `/products?limit=1` 200 → run.app 직통 403을 순서대로 통과했다.

## 함께 확인한 것

| 항목 | 결과 |
|---|---|
| worker 비공개 `/readyz` (SA 임퍼소네이션) | finalize·generate 둘 다 200 `database=ready` |
| `batch-cancel-stale-orders` 수동 실행 | api 로그 200. 15분 주기 2종은 정기분도 200 |
| 일간 배치 3종 `status.code: -1` | 실패 아님 — `lastAttemptTime` 없는 **미실행**(04:10/04:40/05:00 UTC, 배포는 09:06 UTC) |
| scheduler audience vs 실제 run.app URL | 서로 다름이 정상 — api는 자기 URL이 아니라 `local.batch_audience` 문자열로 검증(`deps.verify_batch_token`) |
| `admin.`·`app.` 보안 헤더 | `frame-ancestors 'none'` · `Referrer-Policy: no-referrer` · `X-Frame-Options: DENY` |

## 회귀 감지

Toss 콘솔에서 웹훅 테스트 발송 200을 확인한다. 누군가 BFM을 다시 켜면 deploy 게이트가 먼저
빨간불이 되므로 CI가 조기 경보 역할을 한다.

## 남은 갭

BFM은 대시보드 설정이고 리포에 Cloudflare zone 설정 IaC가 없다(`infra/`는 GCP 전용). 즉 이 OFF는
코드로 고정되지 않아 콘솔에서 되돌려질 수 있다. 지금은 CI 게이트가 감지해주므로 수용한다.
