# Production 클라우드 보안 하드닝 — 후속 작업

2026-08-15 1차 적용(`docs/reviews/cloud-security-hardening-2026-08-15.md`) 뒤에 남은 세 가지를 실행한다.
`essesion.com` 존의 HSTS 기간 상향, 배포 워크플로에 이미지 취약점 스캔 추가, `essesion.com` DNSSEC 활성화다.
1·3번은 Cloudflare 대시보드 작업이라 운영자가 하고, 2번은 에이전트가 할 수 있다. 세 항목은 서로
독립이므로 조건이 찬 것부터 실행한다.

## 왜 필요한가

- **HSTS가 아직 시작값이다(실측 2026-11-18).** `essesion.com`·`www`·`api`·`assets`와 `essesion.shop`이
  모두 `strict-transport-security: max-age=2592000`(30일)로 응답한다. 30일은 2026-08-15에 문제가 생기면
  빨리 풀리도록 잡은 값이고, 안정되면 6개월로 올리기로 했다.
- **이미지 취약점을 본 적이 없다.** 1차 적용 때 Container Scanning API를 켜고 "다음 배포부터 확인"으로
  남겼는데, 이틀 뒤 비용 절감으로 그 API를 껐다(`docs/reviews/gcp-cost-reduction-2026-08-17.md` 2번,
  푸시당 $0.26). 2026-11-18 확인: `containerscanning.googleapis.com`은 꺼져 있고, 배포 중인 api·worker
  이미지(`6dd5ecb`)에는 스캔 결과가 없다. 이전 플랜의 "다음 배포 후 결과 확인"은 기다려도 결과가 나오지
  않는다.
- **CI가 보는 범위에 OS 패키지가 없다.** `.github/workflows/ci.yml:156`의 `osv-scan` job은 `pnpm-lock`과
  `uv.lock`만 본다. `Dockerfile:7`의 베이스 이미지(Debian bookworm)와 `:11`의 `librsvg2-bin`은 아무도
  보지 않는다.
- **DNSSEC를 막던 사유가 사라졌다.** 2026-08-15에는 카페24가 DS 등록을 지원하지 않아 해제했고, 리뷰는
  "DS 등록을 지원하는 등록기관으로 옮기면 다시 켠다"고 적었다. `essesion.com`은 2026-11-12에 Cloudflare
  Registrar에서 샀고, Cloudflare는 자사 Registrar 도메인의 DS를 자동으로 등록한다
  ([Cloudflare DNSSEC](https://developers.cloudflare.com/dns/dnssec/)). 2026-11-18 현재
  `dig +short DS essesion.com`은 비어 있다.

## 범위 밖

- `essesion.shop` 존. HSTS는 올리지 않고 `docs/plans/domain-move-essesion-com.md` E-5가 끈다. DNSSEC도
  켜지 않는다 — 2026-12-12에 만료시키는 도메인이다.
- includeSubDomains·preload. 쓰지 않는 서브도메인까지 HTTPS를 강제할 운영 근거가 생기기 전에는 켜지
  않는다. preload는 max-age 12개월 이상이 조건이다
  ([Cloudflare HSTS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/)).
- 취약점 수정 자체와 배포 차단. 2번은 결과를 보이기만 하고, 고칠 것이 나오면 별도 플랜을 만든다.
- 계정 MFA, 레거시 SA 관찰, Cloudflare Agent token 회전. 1차 리뷰의 "남은 위험"에 있고 이 플랜은 다루지
  않는다.

## 실행 조건

- **1번(HSTS)**: 도메인 이전 플랜의 D(전환)가 끝나고 7일 동안 `.com` 호스트의 HTTPS와 배포가 정상이어야
  한다. D 이전에는 실행하지 않는다 — 전환 중에는 커스텀 도메인을 붙였다 떼는데, 6개월짜리 HSTS를 받은
  브라우저는 그 호스트가 HTTPS를 못 내는 동안 접속하지 못한다.
- **2번(이미지 스캔)**: 조건 없음. 지금 실행할 수 있다.
- **3번(DNSSEC)**: `essesion.com`의 네임서버가 Cloudflare이고 등록기관이 Cloudflare Registrar인 동안에만
  실행한다. 네임서버나 등록기관을 옮길 계획이 생기면 실행하지 말고, 이미 켰다면 옮기기 전에 먼저 끈다.
  DNSSEC가 켜진 채 네임서버를 바꾸면 검증하는 리졸버가 SERVFAIL을 돌려준다(위 Cloudflare DNSSEC 문서).
- **실패 모드**: 1번은 `.shop` 존에서 올리는 것이다. 만료 뒤 남이 등록한 사이트에 6개월짜리 HSTS를
  남긴다. 2번은 "CI의 osv-scan이 통과하니 이미지도 깨끗하다"고 넘기는 것이다. CI는 OS 패키지를 보지 않는다.

## 절차

### 1. HSTS 기간 상향 — 운영자

1. Cloudflare 대시보드에서 **`essesion.com` 존**을 연다. 존 이름을 화면에서 다시 확인한다.
2. SSL/TLS → Edge Certificates → HTTP Strict Transport Security (HSTS)에서 Max Age Header만 6개월로
   바꾼다. includeSubDomains·preload는 Off, No-Sniff는 On 그대로 둔다.
3. 아래 "검증"의 1번 명령으로 확인한다.

### 2. 배포 워크플로에 이미지 스캔 추가 — 에이전트 가능

CI의 `osv-scan`은 lockfile만 보므로 이미지는 따로 스캔해야 한다. 이미지는 `deploy.yml`에서만 빌드되므로
거기에 붙인다. 같은 도구(osv-scanner v2.3.8)의 이미지 스캔을 쓴다 — 무료이고 OS 패키지까지 본다
([OSV-Scanner 이미지 스캔](https://google.github.io/osv-scanner/usage/scan-image)).

1. `.github/workflows/deploy.yml:49`의 `Build images` 스텝 바로 뒤에 스캔 스텝을 넣는다. 인증 전이라
   빌드한 로컬 이미지를 이름으로 스캔한다(러너에 docker가 있다). `$IMAGE_BASE/api:$DEPLOY_SHA`와
   `$IMAGE_BASE/worker:$DEPLOY_SHA` 두 장을 `osv-scanner scan image`로 돌린다.
2. osv-scanner는 `ci.yml:160-168`과 같은 버전·SHA256으로 받아 검증한다. 버전을 올릴 때 두 파일을 함께
   고친다는 주석을 양쪽에 단다.
3. 스텝에 `continue-on-error: true`를 건다. 근거: Debian에는 수정 버전이 없는 CVE가 늘 있어서, 차단으로
   시작하면 고칠 수 없는 항목 때문에 배포가 멈춘다.
4. 첫 배포의 스캔 출력을 읽고 다음 기준으로 나눠 리뷰에 적는다. Python 패키지 항목은 CI와 겹치므로 OS
   패키지 항목만 센다.
   - CVSS 7.0 이상이고 수정 버전이 있는 것: 별도 수정 플랜을 만든다.
   - CVSS 7.0 이상이고 수정 버전이 없는 것: 목록만 남긴다.
   - 그 밖: 건수만 남긴다.

### 3. `essesion.com` DNSSEC 활성화 — 운영자

1. Cloudflare 대시보드 → `essesion.com` 존 → DNS → Settings → DNSSEC → Enable DNSSEC.
2. DS는 Cloudflare가 자동으로 등록한다. 반영에 1~2일 걸릴 수 있고 시점을 수동으로 정할 수 없다
   (위 Cloudflare DNSSEC 문서).
3. 1~2일 뒤 "검증"의 3번 명령으로 확인한다.

### 4. 마무리

세 항목이 끝나면 결과를 `docs/reviews/cloud-security-hardening-followup-<날짜>.md`에 기록하고 이 플랜을
지운다. 도메인 이전 플랜이 이 문서를 가리키는 두 곳(`domain-move-essesion-com.md`의 "아직 확인할 것"과
E-6)도 함께 고친다.

## 검증

```bash
# 1. HSTS — 네 호스트 모두 max-age=15768000, includeSubDomains·preload 없음
for h in essesion.com www.essesion.com api.essesion.com assets.essesion.com; do
  printf '%s: ' "$h"; curl -sSI "https://$h" | grep -i strict-transport-security
done

# 2. 이미지 스캔 — 다음 main 배포의 backend job 로그에 두 이미지의 스캔 표가 나오고,
#    취약점이 있어도 배포가 끝까지 간다
gh run list --workflow deploy.yml --limit 1
gh run view <run-id> --log | grep -i -A5 'osv-scanner'

# 3. DNSSEC — DS 레코드가 나오고, 검증 리졸버가 ad 플래그를 돌려준다
dig +short DS essesion.com
dig +dnssec essesion.com @1.1.1.1 | grep -E 'flags:.* ad'
curl -sS -o /dev/null -w '%{http_code}\n' https://essesion.com   # 200
```

## 되돌리는 법 / 상향 신호

- **HSTS**: Max Age를 다시 1개월로 내린다. 단 이미 6개월 값을 받은 브라우저는 그 기간 동안 HTTPS만
  쓴다 — 내려도 즉시 풀리지 않는다. 신호: `.com` 호스트 중 HTTPS를 못 내는 것이 생겼다. 그때는 HSTS를
  내리는 것보다 HTTPS를 복구하는 쪽이 빠르다. HTTPS를 끄거나 DNS를 DNS only로 돌리거나 Cloudflare를
  일시 중지하지 않는다(위 Cloudflare HSTS 문서).
- **DNSSEC**: 대시보드에서 Disable DNSSEC. 신호: 일부 리졸버에서만 `essesion.com`이 SERVFAIL로
  떨어진다. 네임서버를 옮길 때는 DS의 TTL이 만료될 때까지 기다린 뒤 옮긴다.
- **이미지 스캔**: 스텝을 지운다. 신호: 스캔이 배포 시간을 눈에 띄게 늘리거나 바이너리 다운로드 실패로
  로그만 어지럽힌다.
- **차단으로 올리는 신호**: 수정 버전이 있는 CVSS 7.0 이상 항목이 아무도 안 본 채 여러 배포에 걸쳐 남아
  있으면, `osv-scanner.toml` 예외 목록과 함께 `continue-on-error`를 떼는 플랜을 제안한다.

## 기각한 대안

- **Artifact Analysis 자동 스캔 다시 켜기** — 2026-08-17에 비용 때문에 껐다. 이미지당 $0.26이고 배포마다
  api·worker 두 장이 올라간다([Artifact Analysis 가격](https://cloud.google.com/artifact-analysis/pricing)).
  외부 심사·인증에서 레지스트리 스캔 기록을 요구하면 재론한다.
- **On-Demand Scanning API로 1회 스캔** — 같은 단가에 API를 새로 켜야 한다. osv-scanner로 OS 패키지가
  보이지 않는 것으로 드러나면 재론한다.
- **Trivy·Grype** — 새 도구다. osv-scanner가 이미 CI에 버전·해시로 고정돼 있다.
- **로컬에서 1회 점검** — 도구를 로컬에 또 받아야 하고 한 번 보고 끝난다. 배포 워크플로에 넣으면 같은
  비용으로 매 배포마다 본다.
- **`ci.yml`에 이미지 스캔 job 추가** — CI는 이미지를 빌드하지 않아 스캔만을 위해 PR마다 두 장을 빌드하게
  된다. 이미지를 CI에서도 빌드하게 되면 재론한다.
- **HSTS를 12개월로 올리고 preload 등록** — preload는 되돌리기 어렵고 모든 서브도메인의 HTTPS가
  전제다. 6개월로 한 분기 운영한 뒤 재론한다.
