# Production 클라우드 보안 하드닝 — 후속 작업

2026-08-15 적용 결과는
`docs/reviews/cloud-security-hardening-2026-08-15.md`에 기록했다. 완료된 보강·MFA·DNSSEC 정리는
플랜에서 제거했으며, 아래에는 아직 실행하지 않은 작업만 둔다.

## 1. HSTS 기간 상향

현재 HSTS는 `max-age=2592000`(30일), `includeSubDomains=off`, `preload=off`다. 2026-08-22 이후
모든 현재 호스트의 HTTPS와 배포가 안정적이면 Cloudflare Edge Certificates에서 max-age만 6개월로
올린다. 사용하지 않는 서브도메인까지 인증서를 강제할 운영 근거가 생기기 전에는 includeSubDomains와
preload를 켜지 않는다.

수용 기준:

```bash
curl -sSI https://essesion.shop | grep -i strict-transport-security
```

결과에 `max-age=15768000`이 포함되어야 한다.

## 2. 다음 이미지 스캔 확인

Artifact Analysis API를 활성화한 뒤 새 이미지 배포는 아직 하지 않았다. 다음 정상 main 배포 후
api·worker digest의 취약점 결과를 확인하고 CRITICAL/HIGH가 있으면 별도 수정 플랜을 만든다.
