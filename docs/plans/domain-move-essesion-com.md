# essesion.shop → essesion.com 이전 + iCloud+ 커스텀 도메인 메일

정본 도메인을 `essesion.shop`에서 `essesion.com`으로 옮기고, 사업용 메일 주소(`<주소>@essesion.com`)를
이미 구독 중인 iCloud+ 커스텀 이메일 도메인으로 만든다. 도메인·DNS·SSL은 지금처럼 Cloudflare(Free)에 둔다.
2026-11-11 조사 기준으로 작성했다. 컷오버일(D0)은 아래 "실행 조건"의 문의 3건에 답을 받은 뒤 정한다.

원칙은 하나다 — **새 값을 먼저 더하고, 전환하고, 옛 값은 트래픽이 사라진 뒤 뺀다.**

이 플랜의 실패 모드: 확인하지 못한 외부 정책(토스 재심사, 네이버 재검수)을 확인된 사실처럼
믿고 D0를 잡는 것. 본문에서 "미확인"이라고 적은 항목은 실행자가 직접 확인하기 전에는 사실이 아니다.

## 왜 필요한가

- 사업용 연락처가 개인 네이버 메일이다(`apps/store/src/app/layout/app-layout.tsx:241`,
  `apps/store/src/pages/privacy-policy/index.tsx:144`). 1인 운영이라 월 과금 메일(Google Workspace·네이버웍스)은
  쓰지 않기로 했고, iCloud+는 이미 구독 중이라 추가 비용이 없다.
- Gmail의 타사 주소 "다른 주소에서 보내기"는 2027년 1월에 제거된다
  ([Google 공지](https://support.google.com/mail/answer/17101213?hl=en)). 전달 + Gmail 발신 방식은 쓸 수 없다.
- `.com`으로 바꾸는 김에 메일 도메인도 함께 정리한다. `.shop` 갱신가는 연 US$30 안팎, `.com`은 US$10 안팎이다
  (둘 다 비공식 가격 미러 수치 — 구매 화면에서 확인).

## 범위 밖

- api에 메일 발송 기능을 넣는 일. 지금 api는 메일을 보내지 않는다(알림톡·LMS만). 자동 발송이 필요해지면
  iCloud SMTP를 쓴다 — 예상 발송량이 월 5건 안팎이라 하루 1,000통 한도
  ([Apple 102198](https://support.apple.com/en-us/102198))는 문제가 아니다(2026-11-11 운영자 확인).
  전제는 2단계 6번의 발신 테스트 통과다.
- `app.essesion.com`은 만들지 않는다. `app.`은 예전 컷오버 이전 주소였을 뿐이다(`apps/store/wrangler.jsonc:13`).
- URL 구조·디자인 변경. 도메인 이전과 겹치면 검색 이전 신호가 흐려진다.
- `docs/reviews/`의 과거 기록 속 `essesion.shop` 치환. 당시 사실의 기록이므로 그대로 둔다.
- 통신판매업 변경신고. 신고 당시 인터넷 도메인·전자우편주소를 기재하지 않았으므로 바뀌는 신고 사항이
  없다(2026-11-11 운영자 확인).

## 실행 조건

D0를 잡기 전에 아래 답을 받는다. 답이 없으면 실행하지 말고 기다린다.

1. **토스페이먼츠**(고객센터 1544-7772 또는 상점관리자 채팅): 홈페이지 주소를 바꾸면 카드사 재심사가
   걸리는지, 심사 중에도 결제가 되는지, 결제위젯이 호출 오리진을 등록 주소와 대조하는지. 공개 문서에 답이
   없다. 재심사가 걸리고 심사 중 결제가 막힌다면 이 플랜의 순서를 다시 짠다(실행 금지).
2. **iCloud 메뉴 확인**: iPhone 설정 > [이름] > iCloud > 사용자 설정 이메일 도메인(또는
   icloud.com/icloudplus)에 항목이 보이는지. Apple은 "일부 국가 미제공"이라고만 하고 목록을 내지 않는다.
   안 보이면 메일 부분은 실행하지 않고 대안을 다시 정한다.
3. **네이버 개발자센터**: 네이버 로그인 "서비스 URL"을 바꾸면 재검수가 걸리는지와 기간. 제3자 도움말의
   "재심사가 필요할 수 있다"는 문구만 찾았다.

추가로 확인해 둘 것(순서를 바꾸지는 않는다):

- `essesion.shop` 존의 현재 등록기관·만료일, HSTS 설정(2026-08 기준 max-age 30일, includeSubDomains·preload
  꺼짐 — `docs/plans/cloud-security-hardening.md` §1), 현재 MX 레코드(구 도메인으로 받는 메일이 있는지).
- DB에 `assets.essesion.shop` 절대 URL이 저장돼 있는지. 있으면 5단계에서 CSP·이미지 변환 허용 목록에 구
  호스트를 남긴다.
- Toss 웹훅 처리의 중복 수신 안전성. 신·구 웹훅을 함께 등록한 기간에 같은 이벤트가 두 번 온다.
  `docs/api-spec/money.md:125`는 조회 API 재검증 후 불일치만 교정이라 적고 있어 안전할 것으로 추정 —
  핸들러 테스트로 확인한다.

## 절차

### 1. 도메인 등록과 새 존 (D-14)

1. Cloudflare Registrar에서 `essesion.com`을 신규 등록한다. 연락처는 ASCII만 허용되므로 영문으로 적는다.
   등록자 이메일은 **새 도메인과 무관한 주소**로 둔다 — 미인증이면 도메인이 hold 되는데, 새 도메인 메일을
   쓰면 메일 장애가 도메인 장애로 번진다
   ([Register a new domain](https://developers.cloudflare.com/registrar/get-started/register-domain/)).
2. 새 존에 구 존 설정을 손으로 다시 만든다. 존 설정 복제 기능은 없다. 대상: SSL/TLS 모드, Always Use
   HTTPS, HSTS(구 존과 같은 값, preload는 켜지 않는다), WAF 커스텀·레이트리밋 규칙
   (`docs/reviews/cloudflare-waf-rate-limits-2026-08-14.md`), Bot Fight Mode 상태
   (`docs/reviews/cloudflare-bot-challenge-2026-08-14.md` — api 호스트가 챌린지되지 않게 한 결정을 그대로),
   Image Transformations 활성화(`docs/reviews/image-loading-performance-2026-11-11.md`), DNSSEC.
   규칙 표현식에 `essesion.shop` 리터럴이 있으면 바꾼다.
3. `www.essesion.com` → `https://essesion.com` 301 Single Redirect를 만든다(프록시된 placeholder 레코드
   AAAA `100::` 필요). 구 존의 www 처리와 같게 한다.
4. Email Routing은 **켜지 않는다**. 켜면 Cloudflare MX·SPF가 잠긴 채 들어간다.

### 2. 메일 — iCloud+ 커스텀 이메일 도메인 (D-14, 웹보다 먼저 끝낸다)

인증이 며칠 멈췄다는 사용자 보고가 있어 컷오버와 묶지 않는다. 쇼핑몰을 장기 소유할 Apple 계정에서
설정한다 — 주소는 한 번 묶이면 다른 Apple 계정으로 옮길 수 없다
([Apple 102540](https://support.apple.com/en-us/102540)).

1. iCloud 설정에서 사용자 설정 이메일 도메인 → "나만 사용" → 도메인 입력 → "기존 주소 없음".
2. 화면이 주는 값으로 Cloudflare DNS에 수동 입력한다([Apple 102374](https://support.apple.com/en-us/102374)).
   끝의 마침표·따옴표는 빼고 넣는다(저장이 안 될 때 Apple이 안내하는 방식).

   | 타입 | 이름 | 값 | 비고 |
   |---|---|---|---|
   | TXT | `@` | 화면이 발급하는 `apple-domain=…` 값 | 도메인별 값 |
   | TXT | `@` | `v=spf1 include:icloud.com ~all` | SPF는 하나만 |
   | MX | `@` | `mx01.mail.icloud.com` (우선순위 10) | |
   | MX | `@` | `mx02.mail.icloud.com` (우선순위 10) | |
   | CNAME | `sig1._domainkey` | 화면이 주는 `sig1.dkim.essesion.com.at.icloudmailadmin.com` | **DNS only(회색 구름)** |
   | TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:<리포트 주소>` | Apple 요구 아님, 권장 |

3. Verify 후 주소를 만든다(도메인당 1인 10개까지). 대표 주소 하나만 만든다 — 주소명은 실행자가 정한다
   (예: `contact@`).
4. Gmail로 한 통 보내 "원본 보기"에서 `dkim=pass header.d=essesion.com`과 `dmarc=pass`를 확인한다. Apple이
   서명 도메인을 문서화하지 않았고 불일치 일화가 있어, 이 확인 전에는 DMARC를 `p=none`에서 올리지 않는다.
   2주 문제없으면 `p=quarantine`으로 올린다.
5. 구 도메인으로 받는 메일이 없으면 `essesion.shop`에는 아무 메일 레코드도 추가하지 않는다.
6. 자동 발송 가능 여부를 한 번 확인해 둔다. Apple 계정에서 앱 암호를 만들고 `smtp.mail.me.com:587`
   (STARTTLS, 사용자명은 iCloud 주소)로 보내는 사람을 `@essesion.com` 주소로 지정해 한 통 보낸다.
   Apple 문서는 커스텀 주소 발신을 언급하지 않고 성공·실패 보고가 엇갈린다
   ([Apple 102525](https://support.apple.com/en-us/102525)). 받은 메일의 From과 `dkim=pass`를 확인하고
   결과를 리뷰 문서에 적는다. 거부되면 자동 발송이 필요해질 때 별도 발송 서비스를 고른다.
   테스트용 앱 암호는 확인 후 폐기한다.

### 3. 리드타임 항목 제출 (D-14)

1. **알림톡 새 템플릿 등록.** 승인된 템플릿은 URL 한 글자도 수정할 수 없어 새로 등록해 검수받아야 한다
   (영업일 1~3일, 보장 없음 — [Solapi FAQ](https://solapi.com/guides/kakao-faq)). 본문에 `essesion.shop`
   링크가 든 템플릿 전부를 `essesion.com` 링크로 다시 제출한다. 승인 전까지는 기존 템플릿으로 계속 보낸다
   (구 링크는 301로 살아 있다).

### 4. 외부 콘솔에 새 값 추가 (D-7 ~ D-1, 전부 "추가"라 되돌릴 필요 없음)

| 서비스 | 추가할 것 | 근거 |
|---|---|---|
| 카카오 로그인 | Redirect URI `https://api.essesion.com/auth/kakao/callback`, 사이트 도메인 | 미등록 시 KOE006 ([FAQ](https://developers.kakao.com/docs/latest/ko/kakaologin/faq)) |
| 네이버 로그인 | Callback URL `https://api.essesion.com/auth/naver/callback` (서비스 URL은 D0에 교체) | Callback은 복수 등록 가능, 서비스 URL은 단일 값 |
| 애플 로그인 | Services ID의 Website URLs에 도메인 `essesion.com`·return URL `https://api.essesion.com/auth/apple/callback` | 인증 파일 불필요, 개인 등록은 URL 10개 한도. Services ID 자체는 바꾸지 않는다(`sub` 유지) |
| 구글 로그인 | 승인된 리디렉션 URI에 `https://api.essesion.com/auth/google/callback`, 승인 도메인 | |
| 토스 | 개발자센터 > 웹훅에 `https://api.essesion.com/payments/webhook` 추가 등록 | 수정 기능이 없어 추가 후 구 웹훅을 나중에 삭제 ([웹훅 문서](https://docs.tosspayments.com/guides/v2/webhook)) |
| Search Console | `essesion.com` 속성 추가·소유 확인 | 주소 변경 도구의 전제 |
| 네이버 서치어드바이저 | 새 사이트 등록·소유 확인 | 이전 전용 도구는 찾지 못함 |
| PostHog | Authorized URLs에 `https://essesion.com` | 툴바·일부 필터 |
| Sentry | 프로젝트 Allowed Domains가 좁혀져 있으면 새 도메인 추가 | 미확인 — 설정 화면에서 직접 본다 |

### 5. 프록시 Worker 이중 서빙 (D-3)

api·assets는 리다이렉트하지 않고 **신·구 호스트명에서 함께 서빙**한다. 301/302는 POST를 GET으로 바꿀 수
있고([Single Redirects settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/)),
웹훅 발신자가 리다이렉트를 따른다는 보장도 없다.

1. `infra/cloudflare/api-proxy/wrangler.jsonc:9` — `routes`에 `api.essesion.com` 항목을 **추가**한다(구 항목 유지).
2. `infra/cloudflare/assets-proxy/wrangler.jsonc:11` — `assets.essesion.com`을 **추가**한다(구 항목 유지).
3. `.github/workflows/deploy.yml:165-168` — 배포 검증이 `api.essesion.shop` 라우트 존재만 본다. 두 호스트
   모두 확인하도록 고친다.
4. 배포 후 두 새 호스트명의 인증서가 Active인지 본다. **한 Worker가 서로 다른 두 존의 커스텀 도메인을
   동시에 갖는 구성은 문서에 명시가 없다(추정).** 여기서 배포가 실패하면 D0 전에 드러난다 — 실패 시
   신 호스트용 Worker를 이름만 달리해 따로 배포하는 것으로 우회한다.
5. api `CORS_ORIGINS`에 새 오리진(`https://essesion.com`, `https://admin.essesion.com`)을 **추가**한다
   (구 오리진 유지). 위치: `production.tfvars`의 `api_extra_env`(예시는 `infra/production.tfvars.example:10-12`).
   GCS 업로드 CORS(`infra/variables.tf:104-109`의 `upload_cors_origins` 또는 tfvars 재정의)에도 새 오리진을 추가한다.

### 6. 컷오버 (D0, 한산한 시간대)

웹(store·admin)은 이중 서빙하지 않는다. refresh 쿠키가 api 호스트 전용 `SameSite=Lax`라
(`apps/api/src/api/domains/auth/router.py:56-74`) 프론트와 api의 등록 도메인이 다르면 로그인이 깨진다 —
프론트와 `VITE_API_BASE_URL`을 한 배포로 함께 넘긴다.

1. 저장소 일괄 치환 — `docs/reviews/`를 뺀 전 파일에서 `essesion.shop` → `essesion.com`. 예외와 주의:
   - `apps/store/wrangler.jsonc:17-20` — routes를 `essesion.com` 하나로. `app.` 항목은 지운다.
   - `apps/admin/wrangler.jsonc:9` — `admin.essesion.com`.
   - 5단계에서 손본 api-proxy·assets-proxy routes와 `deploy.yml`은 **구 호스트 항목을 남긴다**.
   - `apps/store/public/_headers:2`, `apps/admin/public/_headers:2` — CSP를 새 api·assets 호스트로. DB에 구
     assets 절대 URL이 있으면 `img-src`에 `https://assets.essesion.shop`도 남긴다.
   - `apps/store/src/shared/lib/image-url.ts:4` — `ASSETS_ORIGIN`. 구 URL이 DB에 남아 있으면 구 오리진도
     변환 대상으로 인식하게 하고, 새 존 Image Transformations의 허용 소스에 `assets.essesion.shop`을 추가한다.
   - SEO: `apps/store/src/shared/seo/page-meta.tsx:6`, `apps/store/index.html:21`,
     `apps/store/public/robots.txt:11`, `apps/store/public/sitemap.xml`, `apps/store/src/pages/home/index.tsx:19-51`,
     `apps/store/src/pages/custom-order/index.tsx:429-430`, `apps/store/src/pages/shop/detail.tsx:57,72`.
   - 발송 문구: `apps/api/src/api/domains/orders/service.py:1168`, `apps/api/src/api/domains/claims/service.py:301,307`.
     정본 명세 `docs/api-spec/domains.md:21,49`를 같은 커밋에서 갱신한다. (참고: 클레임 완료 링크가 명세는
     `/order/claim-list`, 코드는 `/my-page/claims`로 이미 어긋나 있다 — 이 플랜에서 고치지 말고 별도로 보고한다.)
   - 연락처: `apps/store/src/app/layout/app-layout.tsx:241`, `apps/store/src/pages/privacy-policy/index.tsx:144`의
     메일 주소를 2단계에서 만든 주소로 바꾼다.
   - 인프라 기본값·문서: `infra/variables.tf:57,107-108`, `infra/production.tfvars.example`, `infra/README.md`,
     `infra/cloudflare/README.md`, `ARCHITECTURE.md:24,121`.
2. 운영 값 전환: GitHub Actions 변수 `VITE_API_BASE_URL=https://api.essesion.com`, `production.tfvars`의
   `public_api_origin`·`FRONTEND_ORIGIN`·`ADMIN_FRONTEND_ORIGIN`·`PUBLIC_ASSETS_ORIGIN`을 새 도메인으로 바꾸고
   apply한다. `CORS_ORIGINS`는 신·구 모두 유지.
3. 승인된 새 알림톡 템플릿 ID로 `SOLAPI_TEMPLATE_*` 값을 바꾼다. 미승인이면 기존 ID를 유지한다.
4. main 머지 → CI → 배포. 새 호스트에서 "검증" 절의 항목을 확인한다.
5. 구 존 리다이렉트를 켠다. 배포로 `essesion.shop`·`app.`·`admin.`의 커스텀 도메인이 빠진 것을 확인한 뒤,
   각 호스트에 프록시된 placeholder(AAAA `100::`)를 넣고 Single Redirect를 만든다(Free는 존당 10개).
   **Preserve query string을 켠다(기본 꺼짐).** 처음 48시간은 **302**로 두고 문제없으면 301로 바꾼다 —
   301은 브라우저가 캐시해 되돌리기 어렵다.

   | Request URL | Target URL |
   |---|---|
   | `http*://essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://app.essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://www.essesion.shop/*` | `https://essesion.com/${2}` (기존 www 규칙을 교체) |
   | `http*://admin.essesion.shop/*` | `https://admin.essesion.com/${2}` |

   형식은 [공식 예제](https://developers.cloudflare.com/rules/url-forwarding/examples/redirect-all-different-hostname/)와 같다.
   `api.`·`assets.`에는 규칙을 걸지 않는다.
6. 외부 콘솔 전환: 토스 상점관리자 "서비스별 정보"의 홈페이지 주소, 네이버 로그인 서비스 URL
   (둘 다 실행 조건의 답에 따라), GA4 웹 스트림 URL.

### 7. 컷오버 후

1. **D+2**: 리다이렉트를 301로 바꾼 뒤 Search Console 구 속성에서 "주소 변경"을 제출하고 새 사이트맵을
   낸다. GA4 ↔ Search Console 연결은 편집할 수 없으므로 삭제 후 새 속성으로 다시 만든다
   ([Analytics Help](https://support.google.com/analytics/answer/10737381?hl=en)). 서치어드바이저에도 사이트맵 제출.
2. 사이트 푸터의 사업자 정보가 새 도메인에서도 그대로 보이는지 확인한다(카드사 심사 항목).
3. **구 api 호스트 트래픽이 0이 된 뒤**(Cloudflare 분석으로 확인, 최소 30일): 구 Redirect URI·Callback·
   웹훅·구 알림톡 템플릿을 지우고, `CORS_ORIGINS`·CSP에서 구 오리진을 뺀다. api-proxy의 구 호스트 항목은
   지우고 308 리다이렉트로 바꾼다. assets의 구 호스트는 DB에 구 URL이 없을 때만 같은 방식으로 정리한다.
   지운 커스텀 도메인의 인증서는 Edge Certificates에서 수동 삭제한다.
4. `essesion.shop`은 **최소 2년 갱신 유지**한다. Google은 리다이렉트 1년 이상을 권하고
   ([site move](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)),
   이미 발송된 알림톡·문자 링크와 만료 도메인 재등록 악용을 막는 비용이다.
5. 결과를 `docs/reviews/domain-move-essesion-com-<날짜>.md`에 기록하고 이 플랜을 지운다.
   `docs/plans/cloud-security-hardening.md` §1의 검증 명령 도메인도 그때 고친다.

## 검증

```bash
# 메일 (2단계)
dig +short MX essesion.com                       # mx01/mx02.mail.icloud.com
dig +short TXT essesion.com                      # apple-domain=…, v=spf1 include:icloud.com ~all
dig +short CNAME sig1._domainkey.essesion.com    # …icloudmailadmin.com (평탄화되지 않은 CNAME)

# 이중 서빙 (5단계)
curl -fsS https://api.essesion.com/readyz
curl -fsS https://api.essesion.shop/readyz

# 컷오버 (6단계)
curl -sI 'https://essesion.shop/shop?utm_source=x' | grep -i '^location'   # https://essesion.com/shop?utm_source=x
curl -sI https://admin.essesion.shop/ | grep -i '^location'
curl -sI -H 'Origin: https://essesion.com' 'https://api.essesion.com/products?limit=1' | grep -i access-control-allow-origin
git grep -n 'essesion\.shop' -- ':!docs/reviews'   # 남는 것은 프록시 이중 서빙 항목과 의도한 CSP 예외뿐
pnpm lint && pnpm architecture:check
```

브라우저 실측(새 도메인): 4개 소셜 로그인 각각, 테스트 결제 1건과 웹훅 수신, 이미지 업로드(GCS CORS),
상품 이미지 변환(`/cdn-cgi/image`), 배송 시작 알림톡 1건의 링크, 대표 주소로 외부 메일 송수신.

## 되돌리는 법 / 상향 신호

되돌려야 하는 신호: 새 도메인에서 결제 승인 실패, 소셜 로그인 2종 이상 실패, 토스가 주소 변경 후 결제를
막음. 1~5단계는 전부 "추가"라 되돌릴 것이 없다. 6단계만 되돌린다.

1. 구 존의 Single Redirect를 끄고 placeholder 레코드를 지운다(레코드가 남아 있으면 커스텀 도메인 재생성이
   충돌할 수 있다).
2. 6-1 커밋을 revert하고 `VITE_API_BASE_URL`·tfvars를 구 값으로 돌려 재배포한다. api-proxy·assets-proxy는
   이중 서빙 상태 그대로 둔다.
3. 토스 홈페이지 주소·네이버 서비스 URL을 구 값으로 돌린다. 추가해 둔 Redirect URI·웹훅은 그대로 둔다.

302 기간(48시간) 안에 되돌리면 브라우저 캐시에 남는 것이 없다. 메일은 웹과 독립이라 되돌릴 필요가 없다.
iCloud Mail이 장애로 수신을 멈추면 DNS가 Cloudflare에 있으므로 MX를 다른 사업자로 바꾸면 된다(TTL 3600).

방문자는 새 도메인에서 한 번 로그아웃 상태가 되고 비회원 장바구니 등 로컬 상태를 잃는다. 오리진이
바뀌는 한 피할 수 없어 수용한다.

## 기각한 대안

- **Cloudflare Email Routing + Gmail 발신** — Gmail "다른 주소에서 보내기"가 2027-01에 제거된다. 재론 조건 없음.
- **Zoho Mail 무료·Purelymail(연 $10)** — iCloud+를 이미 내고 있어 추가 가입·비용이 불필요. iCloud 메뉴가
  한국 계정에 없거나 인증이 끝내 실패하면 재론한다.
- **Google Workspace·네이버웍스** — 월 과금. 직원이 생겨 공용 사서함·관리 콘솔이 필요해지면 재론한다.
- **웹까지 신·구 이중 서빙** — 같은 번들이 한 api 호스트만 호출하므로 한쪽 도메인에서 쿠키가 교차 사이트가
  되어 로그인이 깨진다. 호스트별로 api 주소를 고르는 런타임 분기를 넣을 만큼의 이득이 없다.
- **구 존 전체를 와일드카드 한 줄로 리다이렉트**(`http*://*.essesion.shop/*`) — api·assets까지 잡아 POST·웹훅이
  깨진다. 호스트별 규칙 4개가 한도(10개) 안이다.
- **api 구 호스트를 처음부터 308** — 웹훅·서버 간 호출이 리다이렉트를 따르는지 확인할 수 없다. 구 호스트
  트래픽이 0이 된 뒤에만 한다.
