# essesion.shop → essesion.com 이전 + iCloud+ 커스텀 도메인 메일

정본 도메인을 `essesion.shop`에서 `essesion.com`으로 옮기고, 사업용 메일 주소(`<주소>@essesion.com`)를
이미 구독 중인 iCloud+ 커스텀 이메일 도메인으로 만든다. 도메인·DNS·SSL은 지금처럼 Cloudflare(Free)에 둔다.
2026-11-11 조사, 2026-11-12 운영자 결정 기준으로 작성했다.

방식은 **동시 운영 후 전환**이다. `.com`을 먼저 띄워 `.shop`과 함께 운영하고(서버를 더 띄우는 것이 아니라
같은 스토어·api에 주소를 하나 더 붙인다), `.com`에서 로그인 등을 확인한 뒤 토스에 주소 변경을 신청하고,
승인 직후 `.com` 결제를 확인한 다음에 `.shop`을 `.com`으로 보낸다. **준비와 동시 운영(A·B)은 2026-11-12에
끝났고, 이 문서에는 남은 단계(C·D·E)만 있다.** 그동안 `.shop`은 평소대로
영업한다. 단계마다 날짜를 정하지는 않는다 — 앞 단계의 확인이 끝나야 다음으로 가되, 아래 기한은 넘기지 않는다.

**기한이 있다.** `essesion.shop`은 2026-12-12에 만료되고 연장하지 않는다(2026-11-12 운영자 결정). 그날부터
`.shop`의 모든 주소(사이트·api·assets·리다이렉트)가 사라지므로, 그 전에 `.shop`에 기대는 것이 하나도 남지
않아야 한다. 역산한 일정:

| 기한 | 단계 |
|---|---|
| 가능한 한 빨리 | C — 토스 홈페이지 주소 변경 신청 |
| 승인 직후 | D 전환 — 토스 승인(문의 답변 기준 약 하루)이 난 뒤 |
| **2026-11-27** | **D 전환의 마지막 날** — 이날까지 301 전환이 끝나야 E의 14일을 채운다 |
| 2026-12-11 | E 완료 — `.shop`에 기대는 것 전부 제거 |
| 2026-12-12 | `.shop` 만료 |

이 플랜의 실패 모드는 둘이다. ① 동시 운영을 위해 넣은 "접속한 도메인을 따라가는" 분기가 정리되지 않고
영구히 남는 것(E단계가 그 정리다). ② 본문에서 "미확인"·"추정"이라고 적은 외부 정책을 확인된 사실처럼
믿는 것.

## 왜 필요한가

- 사업용 연락처가 개인 네이버 메일이다(`apps/store/src/app/layout/app-layout.tsx:241`,
  `apps/store/src/pages/privacy-policy/index.tsx:144`). 1인 운영이라 월 과금 메일(Google Workspace·네이버웍스)은
  쓰지 않기로 했고, iCloud+는 이미 구독 중이라 추가 비용이 없다.
- Gmail의 타사 주소 "다른 주소에서 보내기"는 2027년 1월에 제거된다
  ([Google 공지](https://support.google.com/mail/answer/17101213?hl=en)). 전달 + Gmail 발신 방식은 쓸 수 없다.
- `.com`으로 옮기는 데 기술적 이유는 없다. 가장 일반적인 주소로 가려는 운영자 선호다(2026-11-12 운영자
  확인). 메일 주소를 새로 만드는 시점이라 도메인도 함께 정리한다.
- 유지 비용 차이가 크다. `.shop` 1년 연장은 카페24 기준 약 7만 원이고, `.com`은 Cloudflare에서 연 1만 원
  안팎이다(2026-11-12 운영자 확인). `.shop`을 연장하지 않고 만료 전에 이전을 끝내려는 이유다.
- 동시 운영을 택한 이유: 토스·네이버가 주소 변경을 처리하려면 새 주소에 사이트가 떠 있어야 하고, 등록
  주소가 맞지 않는 상태로 결제를 시험하는 순서는 돈 경로에서 받아들일 수 없다. 변경 처리 자체는 양쪽 모두
  하루 안팎이라고 답을 받았다(2026-11-12 운영자 문의).

## 범위 밖

- api에 메일 발송 기능을 넣는 일. 지금 api는 메일을 보내지 않는다(알림톡·LMS만). 자동 발송이 필요해지면
  iCloud SMTP를 쓴다 — 예상 발송량이 월 5건 안팎이라 하루 1,000통 한도
  ([Apple 102198](https://support.apple.com/en-us/102198))는 문제가 아니다(2026-11-11 운영자 확인).
  전제는 발신 테스트 통과다(A·B 리뷰 문서의 "남은 확인").
- admin의 동시 운영. 사용자가 운영자 한 명이라 D단계에서 한 번에 옮긴다.
- `app.essesion.com`은 만들지 않는다. `app.`은 예전 컷오버 이전 주소였을 뿐이다(`apps/store/wrangler.jsonc:13`).
- URL 구조·디자인 변경. 도메인 이전과 겹치면 검색 이전 신호가 흐려진다.
- `docs/reviews/`의 과거 기록 속 `essesion.shop` 치환. 당시 사실의 기록이므로 그대로 둔다.
- 통신판매업 변경신고. 신고 당시 인터넷 도메인·전자우편주소를 기재하지 않았으므로 바뀌는 신고 사항이
  없다(2026-11-11 운영자 확인).

## 실행 조건

- **결제 전제**: 토스 홈페이지 주소 변경이 승인되기 전에는 `.com`에서 결제가 **안 되는 것으로 본다**
  (2026-11-12 운영자 결정). 토스가 등록 주소를 검사하는지는 공개 자료로 확인되지 않았으므로 안전한 쪽으로
  가정한다. 같은 가정에서, 승인되는 순간부터는 `.shop` 결제가 안 될 수 있다 — C·D의 순서는 이 틈을
  줄이도록 짰다.
- **C단계 진입 조건**: #111이 머지·배포돼 `assets.essesion.com`이 200을 주고, #112의 CI가 통과해 있어야
  토스 변경을 신청한다. 승인이 나면 곧바로 전환해야 하기 때문이다.
- **D단계 진입 조건**: 토스 홈페이지 주소 변경이 **완료된 것을 상점관리자에서 확인**하고 `.com`에서 실결제
  1건이 성공한 뒤에만 #112를 머지한다. 완료 전에는 실행하지 말고 기다린다.

확인해 둔 것:

- Toss 웹훅 처리의 중복 수신 안전성 — **확인 완료(2026-11-11)**: DONE·CANCELED 중복 수신 시 상태·쿠폰·
  incident 변화 없고 알림톡도 1회(`apps/api/tests/test_payments.py`의
  `test_webhook_confirm_sends_payment_done_alimtalk`, `test_webhook_cancel_restores_reserved_coupon`).
  중복 CANCELED는 `action: canceled, orders: 0`으로 ack한다.
- `essesion.com`은 2026-11-12에 Cloudflare Registrar에서 구매했다. `essesion.shop`에는 MX가 없다(2026-11-11
  확인 — 구 도메인으로 받는 메일 없음).
- `essesion.shop` 만료일은 **2026-12-12**다(카페24, 2026-11-12 확인). 연장하지 않고 그 전에 이전을 끝낸다.

아직 확인할 것(순서를 바꾸지는 않는다):

- 구 존의 HSTS 설정(2026-08 기준 max-age 30일, includeSubDomains·preload
  꺼짐 — `docs/plans/cloud-security-hardening.md` §1).
- **DB에 `assets.essesion.shop` 절대 URL이 저장돼 있다(코드로 확인, 2026-11-12).** 상품 이미지는 저장 시점에
  절대 URL로 만들어 컬럼에 넣는다(`apps/api/src/api/domains/admin/products.py:798-800`, `:876-879` —
  `public_asset_url`). 2026-08-21 이후 저장된 상품은 `assets.essesion.shop` 주소를 갖고 있고, `.shop`이
  만료되면 그 이미지는 전부 깨진다. D-2의 마이그레이션이 갱신한다. 팝업·리뷰는 조회 시점에 URL을 만들므로
  (`apps/api/src/api/domains/popups/router.py:87`, `apps/api/src/api/domains/reviews/service.py:52`) 설정만
  바꾸면 따라온다. 그 밖에 절대 URL을 저장하는 컬럼이 있는지는 D-5에서 DB를 직접 센다.
- 토스에 물어볼 것(C단계 신청 때): 승인 시점을 어떻게 알려 주는지(문자·메일·상점관리자), 승인 시각을
  미리 정하거나 영업시간 중으로 맞출 수 있는지, 변경 전후로 신·구 주소가 함께 허용되는 기간이 있는지.

## 절차

### A·B. 준비와 동시 운영 — 완료 (2026-11-12)

실행 결과는 `docs/reviews/domain-move-essesion-com-phase-ab-2026-11-12.md`에 있다. 지금 상태:

- `essesion.com`·`api.essesion.com`이 `.shop`과 같은 스토어·api에 붙어 동시 운영 중이다. `.com`에서 소셜
  로그인 4종이 동작한다(2026-11-12 운영자 확인).
- 토스 등록 주소, 네이버 서비스 URL, 검색 정본, 알림톡 링크는 아직 전부 `.shop`이다.
- 전환용 변경은 PR #112(초안)로 준비돼 있고, 구 존에는 Single Redirect 4개가 **비활성 상태로** 만들어져 있다.
- 남은 준비 항목: 알림톡 새 템플릿 8종 검수 요청(`docs/reviews/alimtalk-com-migration-2026-11-12.md`),
  메일 DKIM 정렬 확인과 발신 테스트(리뷰 문서의 "남은 확인"), Search Console·서치어드바이저·PostHog 등록.

### C. 변경 신청 — 토스

승인 진행 중에는 리다이렉트 없이 두 주소를 그대로 운영한다. 손님은 검색·알림톡 링크를 따라 `.shop`으로
들어와 `.shop`에서 결제한다. `.com`은 알려지지 않은 주소이고, 이 기간에 `.com`에서 결제가 안 되는 것은
감수한다. 승인이 나면 곧바로 D로 넘어간다 — 승인 후 `.shop`을 넘기기 전까지가 `.shop` 결제가 안 될 수 있는
틈이므로, 신청은 승인 연락을 바로 받고 움직일 수 있는 날에 한다.

1. 토스 상점관리자 > 회사정보 > 서비스별 정보 > 홈페이지 정보에서 주소를 `https://essesion.com`으로 바꾼다
   (또는 고객센터 1544-7772). 새 도메인 푸터에 사업자 정보·통신판매업 신고번호가 그대로 보여야 한다
   ([카드사 심사 체크리스트](https://www.tosspayments.com/blog/articles/53711)).
2. 변경이 완료된 것을 상점관리자에서 확인한다. 처리 중에는 하루에 몇 번 확인한다.
3. 토스 승인을 확인하는 즉시 `.com`에서 실결제 1건을 하고 취소한다. 성공하면 바로 D를 실행한다.
   실패하면 D를 실행하지 말고 "되돌리는 법"의 C 항목을 따른다.

네이버 로그인 서비스 URL은 여기서 바꾸지 않는다(2026-11-12 운영자 결정). 손님이 아직 `.shop`에 있는 동안
대표 주소를 먼저 바꾸면 콘솔 안내대로 로그인이 제한될 수 있다. 로그인 동작은 Callback URL만 맞으면 되고,
`.com` Callback은 이미 등록돼 있다. D-8에서 바꾼다.

### D. 전환 — 토스 승인과 `.com` 실결제(C-3)를 확인한 뒤

저장소 변경은 PR #112(초안)에 준비돼 있다 — 스토어·admin 주소, 검색 정본·사이트맵·구조화 데이터, DB 주소
마이그레이션, 인프라 기본값·문서. 알림 문구의 링크는 #110에서 `FRONTEND_ORIGIN`을 따르게 바뀌어 치환 대상이
아니다(4번의 설정 변경으로 따라온다).

1. **머지 전**: GitHub Actions 변수 `VITE_API_BASE_URL`을 `https://api.essesion.com`으로 바꾼다(빌드 시점
   값). 토스 개발자센터 > 웹훅에 `https://api.essesion.com/payments/webhook`을 추가 등록한다(수정 기능이
   없다 — [웹훅 문서](https://docs.tosspayments.com/guides/v2/webhook)). 중복 수신은 안전하다(실행 조건의
   확인 완료 항목). #112를 main 최신에 맞추고 초안을 해제한다.
2. **#112 머지 → CI → 배포.** 배포에서 DB 마이그레이션(backend job)이 Cloudflare 배포(frontend job)보다
   먼저 실행된다(`.github/workflows/deploy.yml:73-90`). 마이그레이션
   (`db/migrations/versions/20261112_8c2f5a1d7e93_assets_host_essesion_com.py`)이 `products.image`·
   `products.detail_images`·`design_examples.photo_full_url`/`photo_detail_url`·`popup_notices.link_url`의
   `essesion.shop`을 `essesion.com`으로 바꾼다. 새 이미지 호스트와 CSP 허용을 #111로 먼저 넣어 둔 이유다 —
   그렇지 않으면 DB가 아직 없는 호스트를 가리키는 구간이 생긴다.
3. **구 존 리다이렉트를 켠다.** 배포로 `essesion.shop`·`app.`·`admin.`의 커스텀 도메인이 빠진 것을 확인한 뒤
   (빠지지 않았으면 대시보드에서 수동으로 뗀다), 각 호스트에 프록시된 placeholder(AAAA `100::`)가 있는지
   확인하고, 만들어 둔 Single Redirect 4개(설명이 `[domain-move, disabled until cutover]`로 시작)를
   활성화한다. 커스텀 도메인이 빠진 뒤 규칙을 켜기 전까지는 `.shop`이 응답하지 않으므로 이 구간을 몇 분
   안에 끝낸다. 규칙은 302·쿼리 보존으로 만들어져 있다.

   | Request URL | Target URL |
   |---|---|
   | `http*://essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://app.essesion.shop/*` | `https://essesion.com/${2}` |
   | `http*://www.essesion.shop/*` | `https://essesion.com/${2}` (켜면서 기존 www→루트 규칙은 끈다) |
   | `http*://admin.essesion.shop/*` | `https://admin.essesion.com/${2}` |

   `api.`·`assets.`에는 규칙을 걸지 않는다 — 301/302는 POST를 GET으로 바꿀 수 있고
   ([Single Redirects settings](https://developers.cloudflare.com/rules/url-forwarding/single-redirects/settings/)),
   웹훅 발신자가 리다이렉트를 따른다는 보장이 없다.
4. **운영 값 전환** — `production.tfvars`(버킷 최신본을 받아 수정): `public_api_origin`·`FRONTEND_ORIGIN`·
   `ADMIN_FRONTEND_ORIGIN`·`PUBLIC_ASSETS_ORIGIN`을 `.com`으로, `ALT_SITE_ORIGINS`를
   `{"https://api.essesion.shop": "https://essesion.shop"}`로(기본 쌍과 추가 쌍을 맞바꾼다), 업로드 CORS에
   `https://admin.essesion.com`을 추가해 apply한다. `CORS_ORIGINS`는 신·구 모두 유지한다. 승인된 새 알림톡
   템플릿 ID가 있으면 `SOLAPI_TEMPLATE_*`도 함께 바꾼다 — 미승인이면 기존 ID를 유지하되 승인되는 대로
   바꾼다(E의 필수 항목). apply 전까지 admin은 로그인이 안 될 수 있다(사용자가 운영자 한 명이라 감수).
5. **DB 확인** — `essesion.shop` 문자열이 남은 행이 있는지 센다. 마이그레이션 대상 컬럼은 0이어야 하고,
   다른 테이블에서 나오면 출처를 확인해 같은 방식의 마이그레이션을 추가한다.
6. `.com` 결제 1건에서 새 웹훅이 수신된 것을 api 로그로 확인하면 구 웹훅을 바로 삭제한다.
7. 처음 48시간은 **302**로 두고 문제없으면 301로 바꾼다 — 301은 브라우저가 캐시해 되돌리기 어렵다.
8. 네이버 로그인 서비스 URL을 `https://essesion.com`으로, GA4 웹 스트림 URL을 새 도메인으로 바꾼다.
9. **301로 바꾼 뒤**: Search Console 구 속성에서 "주소 변경"을 제출하고 새 사이트맵을 낸다. GA4 ↔ Search
   Console 연결은 편집할 수 없으므로 삭제 후 새 속성으로 다시 만든다
   ([Analytics Help](https://support.google.com/analytics/answer/10737381?hl=en)). 서치어드바이저에도 사이트맵 제출.

### E. 정리 — D의 301 전환 후 14일이 지난 뒤, 늦어도 2026-12-11까지

2026-12-12에 `.shop`이 만료되므로 이 단계는 미룰 수 없다. 끝났을 때 `git grep 'essesion\.shop' -- ':!docs/reviews'`
가 비어 있고, 운영 설정·외부 콘솔·DB 어디에도 `.shop` 주소가 남아 있지 않아야 한다.

정리 시점의 근거는 두 가지다.

- **14일**: 로그인 유지 토큰 수명이 14일이다(`apps/api/src/api/config.py:33`의 `refresh_ttl_days`). D 이후
  `.shop` 화면은 리다이렉트돼 새 세션이 생기지 않으므로, 14일이 지나면 `api.essesion.shop`에 묶인 세션은
  전부 만료된다. 그 전에 구 호스트를 없애면 열어 둔 탭의 사용자가 조용히 로그아웃된다.
- **남은 요청 확인**: 정리 전에 Cloudflare 대시보드(구 존 > Analytics, 호스트 `api.essesion.shop` 필터)에서
  최근 요청을 본다. 구 웹훅은 D-6에서 이미 지웠으므로 요청이 없어야 정상이다. 남아 있으면 출처를 확인해
  새 주소로 옮긴다. 다만 **기한이 우선이다** — 2026-12-12에는 구 주소가 어차피 사라지므로, 출처를 못 찾아도
  2026-12-11에는 정리를 끝낸다.

1. 허용 쌍 목록에서 `.shop` 쌍을 뺀다 — 이 순간 다시 고정 주소다. `CORS_ORIGINS`·GCS CORS·CSP에서 구
   오리진을 뺀다.
2. `apps/store/src/shared/config/env.ts`의 `ON_NEW_DOMAIN` 분기를 지우고 빌드 시 고정값으로 되돌린다. `.shop`이
   리다이렉트된 뒤에는 죽은 코드다.
3. 구 Redirect URI·Callback·구 알림톡 템플릿을 각 콘솔에서 지운다. 이 시점에 `SOLAPI_TEMPLATE_*`가 전부 새
   템플릿 ID인지 확인한다 — 기존 템플릿이 하나라도 남아 있으면 만료 뒤 죽은 링크가 발송된다.
4. api-proxy·assets-proxy의 구 호스트 항목, `deploy.yml`의 구 호스트 검증, CSP와 `image-url.ts`의 구 assets
   예외, 새 존 Image Transformations 허용 소스의 `assets.essesion.shop`을 지운다. DB에 구 assets 절대 URL이
   있었다면 그 갱신이 끝난 뒤에 한다. 지운 커스텀 도메인의 인증서는 Edge Certificates에서 수동 삭제한다.
5. `essesion.shop`은 연장하지 않고 2026-12-12에 만료시킨다(2026-11-12 운영자 결정). 리다이렉트는 전환부터
   만료까지 2~3주만 살아 있다. 감수하는 것:
   - 만료 전에 발송된 알림톡·문자의 `.shop` 링크와 손님의 즐겨찾기는 만료 뒤 열리지 않는다.
   - Google은 주소 변경 후 리다이렉트를 최소 180일 유지하라고 한다
     ([Search Console Help](https://support.google.com/webmasters/answer/9370220?hl=en)). 그보다 짧아 검색
     순위가 `.com`으로 다 넘어오지 않을 수 있고, `.com`이 새 사이트처럼 다시 쌓일 수 있다.
   - 만료된 도메인은 일정 기간 뒤 누구나 다시 등록할 수 있다. 옛 링크가 남의 사이트로 연결될 수 있다.
   구 존의 HSTS(max-age 30일)는 D 직후에 끈다 — 만료 뒤 남이 등록한 사이트에 영향을 주지 않게 정리한다.
6. 결과를 `docs/reviews/domain-move-essesion-com-<날짜>.md`에 기록하고 이 플랜을 지운다.
   `docs/plans/cloud-security-hardening.md` §1의 검증 명령 도메인도 그때 고친다.

## 검증

```bash
# 전환 전 (C 진입 조건)
curl -sI https://assets.essesion.com/<존재하는 키> | head -1          # 200 — #111 배포 확인

# 전환 (D)
curl -fsS https://api.essesion.com/readyz
curl -sI 'https://essesion.shop/shop?utm_source=x' | grep -i '^location'   # https://essesion.com/shop?utm_source=x
curl -sI https://admin.essesion.shop/ | grep -i '^location'
curl -s 'https://api.essesion.com/products?limit=1'                        # image가 assets.essesion.com
curl -s -o /dev/null -D - https://api.essesion.com/auth/kakao/login | grep -i '^location'   # redirect_uri가 api.essesion.com
git grep -n 'essesion\.shop' -- ':!docs/reviews' ':!docs/plans'   # 남는 것은 구 호스트 유지 항목과 테스트의 추가 쌍뿐

# 정리 (E) 뒤
git grep -n 'essesion\.shop' -- ':!docs/reviews' ':!docs/plans'   # 비어 있어야 한다
```

브라우저 실측(전환 뒤 `.com`에서): 소셜 로그인 4종, 실결제 1건과 취소·웹훅 수신, 이미지 업로드(GCS CORS),
상품 이미지 변환(`/cdn-cgi/image`), 배송 시작 알림톡 1건의 링크, admin 로그인.

## 되돌리는 법 / 상향 신호

- **A·B(완료)**: `.com` 동시 운영이 `.shop` 영업에 문제를 일으키면 #110을 revert하고 `ALT_SITE_ORIGINS`를
  비워 apply한다 — 기존 고정 주소 동작으로 돌아간다. iCloud Mail이 장애로 수신을 멈추면 DNS가 Cloudflare에
  있으므로 MX를 다른 사업자로 바꾼다(TTL 3600).
- **C**: 승인 전에 `.shop`에서 결제가 막히면 토스에 원인을 확인한다. 승인 후
  `.com` 실결제(C-3)가 실패하면 D를 실행하지 말고 토스에 문의하되, 그동안 `.shop` 결제도 막혀 있으면 등록
  주소를 `.shop`으로 되돌려 달라고 요청한다 — 두 주소 모두 결제가 안 되는 상태를 오래 두지 않는다.
- **D**: 신호는 새 도메인에서 결제 승인 실패 또는 소셜 로그인 2종 이상 실패. 되돌리면 손님이 `.shop`으로
  돌아가는데, 토스 등록 주소가 이미 `.com`이라 결제 전제상 `.shop` 결제가 안 될 수 있다. 그래서 **먼저
  `.com`에서 고쳐서 해결하는 것을 우선**하고, 되돌리는 것은 `.com`에서 결제 자체가 안 될 때만 한다.
  되돌릴 때: ① 구 존의 Single Redirect를 끄고 placeholder 레코드를 지운다(레코드가 남아 있으면 커스텀
  도메인 재생성이 충돌할 수 있다). ② #112를 revert하고 D-4의 운영 값을 되돌려 재배포한다 — B의 동시
  운영 상태로 돌아간다. ③ `.shop`에서 실결제 1건을 시험하고, 안 되면 토스에 등록 주소를 `.shop`으로
  되돌려 달라고 요청한다. 302 기간(48시간) 안에 되돌리면 브라우저 캐시에 남는 것이 없다.

- **일정 상향 신호**: D의 301 전환이 **2026-11-27까지 끝나지 않으면** `.shop`을 카페24에서 1년 연장한다. 그날을
  넘기면 E의 14일을 채우지 못한 채 영업 중인 주소가 만료된다. 알림톡 검수 반려와 토스 승인 지연이
  대표적 원인이다. 연장하면 기한 표의 날짜는 모두 풀린다.

방문자는 새 도메인에서 한 번 로그아웃 상태가 되고 비회원 장바구니 등 로컬 상태를 잃는다. 로그인 상태는
넘겨줄 방법이 있지만 하지 않기로 했다(기각한 대안 참조). 로컬 상태는 오리진이 바뀌는 한 옮길 수 없다.

## 기각한 대안

- **한 번에 전환(동시 운영 없이 컷오버)** — 인증 코드를 건드리지 않아 가볍지만, 토스·네이버 변경을 신청할
  때 새 주소에 사이트가 없거나, 등록 주소가 맞지 않는 채로 전환부터 하고 결제를 시험하게 된다. 2026-11-12
  운영자 결정으로 기각. 재론 조건 없음.
- **`.shop` 1년 연장 후 여유 있게 이전** — 리다이렉트를 1년 유지해 옛 링크와 검색 순위를 지킬 수 있지만,
  연장비가 약 7만 원으로 `.com` 1년(약 1만 원)의 7배라 내지 않고 한 달 안에 끝내기로 했다(2026-11-12
  운영자 결정). D가 2026-11-27까지 끝나지 않으면 재론이 아니라 바로 연장한다(되돌리는 법의 일정 상향 신호).
- **Cloudflare Email Routing + Gmail 발신** — Gmail "다른 주소에서 보내기"가 2027-01에 제거된다. 재론 조건 없음.
- **Zoho Mail 무료·Purelymail(연 $10)** — iCloud+를 이미 내고 있어 추가 가입·비용이 불필요. iCloud 메뉴가
  한국 계정에 없거나 인증이 끝내 실패하면 재론한다.
- **Google Workspace·네이버웍스** — 월 과금. 직원이 생겨 공용 사서함·관리 콘솔이 필요해지면 재론한다.
- **로그인 상태를 새 도메인으로 넘겨주기** — 구 도메인이 1분짜리 암호화 토큰을 만들어 새 도메인에 넘기고
  새 도메인이 쿠키를 다시 심는 방식([Inflection 사례](https://www.youssefm.com/posts/transferring-cookies)).
  인증 경로에 임시 코드가 하나 더 생기는데, 방문자가 적고 소셜 로그인이라 다시 로그인하는 부담이 버튼 한
  번이다. 재로그인 불만이 실제로 들어오면 재론한다.
- **요청 호스트로 리다이렉트 주소를 그대로 조립** — 허용 목록 없이 호스트 헤더를 믿으면 로그인 후 임의
  도메인으로 보내는 통로가 된다. 허용 쌍 목록으로만 고른다.
- **구 존 전체를 와일드카드 한 줄로 리다이렉트**(`http*://*.essesion.shop/*`) — api·assets까지 잡아 POST·웹훅이
  깨진다. 호스트별 규칙 4개가 한도(10개) 안이다.
- **api 구 호스트를 리다이렉트로 돌리기** — 웹훅·서버 간 호출이 리다이렉트를 따르는지 확인할 수 없다.
  구 호스트는 E에서 그냥 떼고, 2026-12-12 만료로 사라지게 둔다.
