# 스토어 계측 활성화 (GA4 켜기 + PostHog 도입)

**전제**: GA4는 **2026-08-14부터 이미 가동 중이다** — `VITE_GA_MEASUREMENT_ID=G-1V993D3825`가
GitHub 변수에 설정돼 있고 배포 번들에서 확인된다(2026-08-19 실측). PostHog은 콘솔 프로젝트만
생성된 상태다. 이 플랜은 두 부분이고 **독립 실행 가능**하다.

- **A. GA4 마무리** — 코드 변경 없음. 콘솔 설정 두 가지. 계측은 이미 켜져 있다.
- **B. PostHog 도입** — 코드 변경 있음. A와 무관하게, 준비되면 실행한다.

관련: `docs/reviews/pre-deploy-code-gaps-2026-08-14.md` §G2(GA4 배선이 이미 끝나 있다는 판정),
`ARCHITECTURE.md`, `infra/README.md`(프론트 빌드 변수 주입).

## 왜 필요한가

GA4는 이미 돌고 있지만(2026-08-14~) 공백이 남는다. Sentry(`apps/store/src/shared/lib/observability.ts`)는
에러만 잡고, GA4(`apps/store/src/shared/lib/analytics.ts`)는 집계만 준다. 이 서비스의 핵심 화면인 디자인 생성에서 GA4가 받는 것은
`generate_design { rejected: "0" | "1" }` 하나뿐이고(`analytics.ts`의 `GaEvents`), 프롬프트
원문·세션 ID는 PII 정책상 의도적으로 뺐다(`use-generate.ts:101` 주석). 그래서 GA4로는
"거절이 몇 %인가"까지만 알 수 있고 **"사용자가 무엇을 하다 떠났는가"는 원리적으로 알 수 없다**.
그 질문에 답하는 것이 PostHog(세션 리플레이·퍼널) 도입의 유일한 근거다.

트래픽 통계(유입 채널, 방문자 수)만 놓고 보면 두 툴은 중복이다. **중복을 감수하는 이유는
GA4의 광고·검색 연동과 PostHog의 개인 단위 여정이 서로를 대체하지 못하기 때문**이며, 이
경계가 무너지면(예: PostHog로 채널 리포트를 만들기 시작하면) 유지비만 두 배가 된다.

계측 데이터는 소급 수집이 불가능하다. 트래픽이 적은 지금이 계측 실수를 가장 싸게 고칠 시기다.

## 범위 밖 (non-goals)

- **서버사이드 이벤트 전송**(api → PostHog/GA4). 클라이언트 이벤트는 비율 관측용이고 매출
  정본은 DB다. 두 숫자를 일치시키려는 작업은 하지 않는다.
- **admin 앱 계측**. 내부 도구이므로 제품 분석 대상이 아니다.
- **피처 플래그·A/B·서베이·PostHog 에러 트래킹**. 에러는 Sentry가 정본이고, 플래그는 쓸 실험이
  생긴 뒤에 켠다.
- **GA4 이벤트 스키마 변경**. 현행 10종을 그대로 둔다.
- **PostHog 리버스 프록시**. 기각한 대안 참고.

## 실행 조건

**A(GA4)**: 선행 조건 없음. **A-1은 2026-08-14에 이미 완료됐다** — 재실행하지 말 것. 남은 건
GA4 웹 콘솔 설정(A-2·A-3)뿐이고, 이건 편집자 권한을 가진 사람이 직접 해야 한다.
**A-2는 시한이 있다**: 보존 기본값이 2개월이라 2026-10-14 전후로 8월분 세부 데이터가 지워지기
시작한다. 그 전에 14개월로 바꾼다. **A-3(Search Console)은 지금 실행 가능**하고, **A-4(UTM)는
첫 광고 링크를 만들기 직전까지 실행하지 않는다** — 채널이 미정인 지금 값을 정하면 버려진다.

**B(PostHog)**: A와 순서 의존이 없다. 단 **절차 5(마스킹)를 건너뛴 채 배포하면 안 된다** —
배송지·연락처 입력이 리플레이에 평문으로 남는다. 마스킹 확인이 끝나기 전에는 프로젝트 설정에서
리플레이를 켜지 않는다.

## 절차

### A. GA4 켜기

1. **측정 ID 주입 — 이미 완료(2026-08-14).** `VITE_GA_MEASUREMENT_ID=G-1V993D3825`가 설정돼
   있고 배포 번들에 반영돼 있다. 배선(`main.tsx:14` → `initAnalytics()`, SPA 페이지뷰는
   `apps/store/src/app/layout/app-layout.tsx:271`)도 완결이다. **할 일 없음** — 남은 것은
   GA4 콘솔 > 보고서 > 실시간에서 데이터가 실제로 들어오는지 한 번 보는 것뿐이다.

2. **데이터 보존 14개월로 변경 — 시한 있음.** GA4 관리 > 데이터 설정 > 데이터 보존. 편집자 권한 필요.
   기본값 2개월은 **표준 집계 보고서에는 영향이 없지만 탐색(Explore)·퍼널·사용자 단위 분석용
   세부 데이터를 지운다.** 계측 시작이 2026-08-14이므로 **2026-10-14 전후로 8월분이 삭제되기
   시작한다** — 그 전에 바꾼다. 표준 속성 최대치는 14개월이며, 삭제된 세부 데이터는 복구되지 않는다.
   (출처: <https://support.google.com/analytics/answer/7667196>)

3. **Search Console 연동.** 검색 유입 키워드를 보기 위해 연결한다. 선행 조건은 **Search Console에
   `essesion.shop` 속성이 있고 소유권이 확인(verified owner)된 상태**이며, GA4 쪽은 편집자 권한이
   필요하다. 소유권 확인은 DNS TXT 레코드가 가장 쉽다 — 도메인이 Cloudflare에 있다.
   연결: GA4 관리 > 제품 링크 > Search Console 링크 > 데이터 스트림 선택.

   **연결만 하면 보고서가 안 보인다.** GA4 좌측 라이브러리에서 **Search Console 컬렉션을 게시**해야
   `Google 자연 검색어`·`Google 자연 검색 트래픽` 두 보고서가 나타난다. 이 단계를 빠뜨려서
   "연동했는데 아무것도 없다"가 되는 게 흔한 경로다. 데이터는 48시간 내 반영되고 최대 16개월까지
   소급된다. **링크는 수정이 안 되므로**(지우고 다시 만들어야 함) 데이터 스트림을 처음에 맞게 고른다.
   (출처: <https://support.google.com/analytics/answer/10737381>)

   사이트맵(`apps/store/public/sitemap.xml`)과 robots.txt는 이미 배포돼 있으니 Search Console에
   사이트맵 URL만 제출하면 된다. 다만 현재 사이트맵은 **정적 경로 10개뿐이고 상품 상세는 없다** —
   상품 페이지를 검색에 태우려면 동적 사이트맵이 필요하지만, 그건 이 플랜 범위 밖이다.

4. **UTM 규칙 — 첫 광고 직전에 실행.** 광고 계획은 2026년 10~11월경이고 채널은 미정이다.
   **지금 `utm_source` 값을 정하지 않는다** — 안 쓸 값을 미리 정하면 그때 다시 정하게 된다.
   형식 규칙(소문자, `utm_medium` 4종, `utm_campaign`은 연월-이름)은 `docs/analytics.md`에
   이미 적혀 있다. 첫 광고 링크를 만들기 **전에** 그 문서의 `utm_source` 표를 먼저 채운다.
   링크부터 만들면 표기가 갈리고, 이건 사후에 못 고친다.

### B. PostHog 도입

4. **의존성·배선 추가.** `posthog-js`를 `apps/store`에 추가하고,
   `apps/store/src/shared/lib/analytics.ts` 옆에 별도 모듈로 둔다. 기존 GA4 모듈과 섞지 않는다 —
   역할이 다르고, 한쪽을 끌 때 다른 쪽이 딸려가면 안 된다. 구현 규칙:
   - 환경변수 `VITE_POSTHOG_KEY`(+ 호스트가 EU면 `VITE_POSTHOG_HOST`)를 만들고
     `apps/store/src/vite-env.d.ts`에 GA4·Sentry와 같은 형식으로 선언한다. **값이 없으면 완전한
     no-op** — 로컬·테스트에서 이벤트가 새면 안 된다(`analytics.ts`·`observability.ts`의 기존 규약).
   - SDK는 **지연 로드**한다. `observability.ts:5`의 `loadSentry()` 패턴(`import()` 1회 캐시)을
     그대로 쓴다. 엔트리 청크가 커지면 첫 페인트가 느려지고, 그건 계측으로 잃는 게 아니라 잃는다.
   - `main.tsx`에서 `initObservability()`·`initAnalytics()` 옆에 초기화 한 줄.
   - **번들 증가분을 실측해 이 플랜에 적는다** — `pnpm --filter store build` 전후 dist 크기 비교.
     기억으로 추정한 수치를 쓰지 않는다.

5. **리플레이 마스킹 확인 — 배포 전 필수.** PostHog은 입력 요소를 기본 마스킹하지만,
   **입력이 아닌 곳에 렌더된 개인정보는 마스킹되지 않는다.** store에서 점검할 대상:
   - 배송지·수령인·연락처가 **텍스트로 표시되는** 화면 — 주문서 확인 단계, 마이페이지 주문 내역
     (`apps/store/src/pages/order/`, `apps/store/src/pages/my-page/`).
   - 카카오 우편번호 위젯(`postcode.map.daum.net`) — iframe이라 캡처되지 않을 가능성이 높으나
     **실측으로 확인**한다.
   - Toss 결제창은 iframe(`frame-src https://*.tosspayments.com`)이라 캡처 대상이 아니다.

   가려야 할 요소에는 PostHog의 마스킹 클래스를 붙인다. 판단이 애매하면 **가리는 쪽으로 기운다** —
   리플레이에 안 찍혀서 아쉬운 것과, 남의 주소가 PostHog에 남는 것은 비교 대상이 아니다.
   (참고: <https://posthog.com/docs/session-replay/privacy>)

6. **CSP 확장.** `apps/store/public/_headers`의 CSP는 `default-src 'none'`이라 PostHog가 그냥은
   전부 차단된다. 추가할 것 (출처: <https://posthog.com/docs/advanced/content-security-policy>):
   - `script-src`에 `https://*.posthog.com`
   - `connect-src`에 `https://*.posthog.com`
   - **`worker-src 'self' blob:` 지시자를 새로 추가** — 현재 파일에 `worker-src`가 없고
     `default-src 'none'`으로 폴백되므로 리플레이의 워커가 죽는다. **이 항목을 빠뜨리는 것이
     이 플랜에서 가장 나오기 쉬운 실수다.**
   - PostHog 툴바(콘솔에서 페이지 위에 띄우는 디버그 UI)를 쓸 거면 `img-src`·`style-src`·
     `font-src`·`media-src`에도 같은 호스트가 필요하다. 툴바를 안 쓸 거면 넣지 않는다.
   `apps/admin/public/_headers`는 건드리지 않는다(범위 밖).

7. **리플레이 켜기 + 샘플링.** PostHog 콘솔 프로젝트 설정에서 리플레이를 켠다. **처음에는
   샘플링을 낮게(10~20%) 잡는다** — 무료 한도가 월 5,000 세션이고(출처:
   <https://posthog.com/pricing>), 전량 녹화는 트래픽이 조금만 늘어도 한도를 태운다. 5번
   마스킹 확인이 끝나기 전에는 켜지 않는다.

8. **기존 이벤트 fan-out.** `analytics.ts`의 `trackEvent`가 이미 10종을 쏘고 있다
   (`view_item`·`add_to_cart`·`add_to_wishlist`·`begin_checkout`·`purchase`·`token_purchase`·
   `generate_design`·`quote_request`·`login`). **새 이벤트 스키마를 설계하지 않는다** — 호출부
   10곳(`grep -rn "trackEvent(" apps/store/src`)은 그대로 두고, `trackEvent` 내부에서 PostHog에도
   같은 이름·같은 파라미터로 흘린다. PII 금지 규약(`analytics.ts` 최상단 주석)이 그대로 승계된다.
   autocapture는 켜 둔다 — 나머지 클릭은 설계 없이 자동으로 쌓인다.

9. **퍼널 하나만 정의.** PostHog 콘솔에서 `방문 → generate_design → login → purchase` 퍼널을
   만든다. 대시보드를 여러 개 만들지 않는다 — 안 보는 대시보드는 유지비다. 어떤 화면을 볼지는
   `docs/analytics.md`에 적는다.

## 검증

- **A-1**: 이미 통과. 재확인이 필요하면 GA4 콘솔 > 보고서 > 실시간에 방문이 잡히는지 본다.
  번들 반영 여부는 `curl -s https://essesion.shop/assets/index-*.js | grep -c G-1V993D3825`.
  로컬(`VITE_GA_MEASUREMENT_ID` 미설정)에서는 gtag 요청이 **없어야** 정상이다.
- **A-2**: GA4 관리 > 데이터 보존이 "14개월"로 저장됐는지 화면에서 확인.
- **A-3**: 라이브러리에서 컬렉션을 게시한 뒤, 48시간 지나 GA4 보고서에 `Google 자연 검색어`가
  뜨고 실제 검색어 행이 채워지는지 확인한다. 비어 있으면 연결이 아니라 **게시**를 안 한 것이거나
  아직 48시간이 안 된 것이다.
- **B-6**: 배포 후 DevTools Console에 CSP 위반 로그가 **하나도 없어야** 한다. 특히
  `worker-src`/`blob:` 관련 위반이 보이면 6번을 덜 한 것이다.
- **B-5**: PostHog 콘솔에서 자기 세션 리플레이를 열어 **주문/마이페이지 화면을 직접 눈으로 본다.**
  주소·연락처가 읽히면 즉시 리플레이를 끄고 해당 녹화를 삭제한 뒤 마스킹을 고친다.
  (`.claude/skills/aside-browser/SKILL.md`의 브라우저 하네스 사용)
- **B-8**: 상품 상세 → 장바구니 → 결제 시작을 한 번 태우고, PostHog 활동 탭에서 `view_item`,
  `add_to_cart`, `begin_checkout`이 GA4와 같은 이름으로 들어오는지 대조.
- **전체**: `pnpm lint && pnpm typecheck && pnpm test && pnpm architecture:check`.

## 되돌리는 법 / 상향 신호

- **A 되돌리기**: `gh variable delete VITE_GA_MEASUREMENT_ID` — 단, `deploy.yml:99`가 이 변수를
  frontend job 게이트로 쓰므로 **지우면 프론트 배포 자체가 스킵된다.** GA만 끄고 싶다면 변수를
  지우지 말고 게이트 조건을 함께 손봐야 한다. 보존 기간은 되돌릴 수 없다 — 늘렸다 줄이면
  줄인 시점에 초과분이 삭제된다.
- **B 되돌리기**: `VITE_POSTHOG_KEY`를 비우면 모듈이 no-op이 되어 즉시 꺼진다(코드 롤백 불필요).
  리플레이만 끄려면 PostHog 콘솔에서 토글.
- **상향 신호 — 서버사이드 전송으로 올릴 때**: GA4/PostHog의 `purchase` 건수가 DB 주문 건수보다
  뚜렷하게(대략 20% 이상) 적으면 애드블록·결제 후 이탈로 유실되고 있다는 뜻이다. 그때 api에서
  서버사이드로 쏘는 것을 검토한다. 그 전까지는 범위 밖이다.
- **상향 신호 — 리버스 프록시**: 위 유실률이 계속 커지면 기각한 대안의 프록시를 재검토한다.
- **상향 신호 — 무료 한도**: PostHog 사용량이 월 100만 이벤트 또는 5,000 리플레이에 근접하면
  autocapture 범위를 좁히거나 샘플링을 더 낮춘다. 유료 전환은 그 다음 선택지다.

## 기각한 대안

- **PostHog만 쓰고 GA4를 버린다** — 채널 리포트만 보면 가능하지만, Google Ads·Search Console
  연동이 GA4에만 있다. 광고를 안 돌릴 것이 확정되면 재론한다.
- **GA4만 쓰고 PostHog을 버린다** — 세션 리플레이가 없으면 디자인 생성 이탈을 볼 수단이 사라진다.
  이 플랜의 유일한 근거가 그거라 기각. 리플레이를 6개월 이상 아무도 안 열어보면 재론한다.
- **PostHog 리버스 프록시(Cloudflare Worker)** — `infra/cloudflare/api-proxy`와 같은 패턴으로
  자체 도메인 경유가 가능하고 애드블록 회피에 유리하지만, 지금 없는 문제를 위해 워커를 하나 더
  운영하는 것은 이르다. 위 "상향 신호 — 리버스 프록시"가 뜨면 재론한다.
- **GTM(태그 매니저) 도입** — 코드 배포 없이 태그를 얹는 게 장점이나, 이 레포는 프론트 배포가
  이미 자동이라 얻는 게 없고 CSP만 넓어진다. 마케터가 직접 태그를 붙일 상황이 되면 재론한다.
- **`generate_design`에 프롬프트 원문 싣기** — 거절 원인을 보는 가장 빠른 길이지만 PII 규약
  위반이다(`analytics.ts` 주석). 프롬프트 분석이 필요하면 계측이 아니라 DB/워커 로그에서 본다.

## 실패 모드

**"둘 다 켜놓고 아무도 안 본다"가 이 플랜의 실패 모드다.** 계측을 붙이는 비용은 작지만, 볼
사람과 볼 주기가 정해지지 않으면 대시보드는 유지비만 남는다. 그래서 절차 9는 퍼널 하나로 묶고,
무엇을 언제 보는지는 `docs/analytics.md`에 따로 적는다.

부차적 실패 모드 둘: (1) 절차 6의 `worker-src` 누락으로 리플레이가 조용히 안 찍히는 것 —
CSP 위반은 콘솔에만 남고 SDK는 에러를 안 던진다. (2) 절차 5를 건너뛰어 배송지·연락처가 리플레이에
남는 것 — 되돌려도 이미 녹화된 것은 지워야 한다.
