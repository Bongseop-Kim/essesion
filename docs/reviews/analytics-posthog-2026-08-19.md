# PostHog 도입 + GA4 현황 정리 (2026-08-19)

`docs/plans/analytics-posthog.md`의 **코드 작업(B)을 실행한 결과**다. 콘솔 설정은 사람이 해야
하므로 플랜에 남겨뒀다. GA4는 손댄 것이 없다 — 이미 가동 중이었다.

## GA4는 이미 켜져 있었다

플랜을 쓸 때 "코드는 완성됐지만 측정 ID가 없어 no-op"으로 판단했으나 **틀렸다**.
`VITE_GA_MEASUREMENT_ID=G-1V993D3825`가 2026-08-14부터 GitHub 변수에 있었고, 배포 번들에도
들어 있다(`curl -s https://essesion.shop/assets/index-*.js | grep -c G-1V993D3825` → 1).
코드만 보고 배포 변수를 확인하지 않은 것이 원인이다. 계측은 2026-08-14부터 쌓이는 중이다.

## PostHog 배선

US 리전(`https://us.i.posthog.com`), `posthog-js@1.418.1`.

| 파일 | 변경 |
|---|---|
| `apps/store/src/shared/lib/product-analytics.ts` | 신규. 지연 로드·no-op 가드·`before_send` URL 정리·리플레이 마스킹 경로 판정 |
| `apps/store/src/shared/lib/analytics.ts` | `trackEvent`·`trackPageView`에서 PostHog로 fan-out. 호출부 10곳은 그대로 |
| `apps/store/src/shared/lib/observability.ts` | `withoutQuery`를 export — Sentry와 PostHog이 같은 쿼리 제거 규약을 공유 |
| `apps/store/src/app/layout/app-layout.tsx` | 개인정보 경로에서 `#main-content`에 `ph-no-capture` |
| `apps/store/public/_headers` | CSP에 `https://*.posthog.com`(script-src·connect-src), **`worker-src 'self' blob:` 신설** |
| `apps/store/src/vite-env.d.ts`, `.env.example`, `.github/workflows/deploy.yml` | `VITE_POSTHOG_KEY`·`VITE_POSTHOG_HOST` |
| `apps/store/src/shared/lib/product-analytics.test.ts` | 신규. no-op·fan-out·쿼리 제거·마스킹 경로 |

### 새 이벤트를 만들지 않았다

`GaEvents` 10종을 그대로 PostHog에 흘린다. 손으로 정의한 이벤트는 이름을 영구히 유지해야 하는
부채이고, autocapture가 나머지 클릭을 알아서 모은다. 이벤트 스키마 정본은 여전히 `analytics.ts`다.

### 마스킹은 요소가 아니라 경로 단위로

`/order`·`/my-page`·`/login`·`/auth` 진입 시 본문 전체에 `ph-no-capture`를 건다
(`isReplayMaskedPath`). 요소마다 클래스를 붙이는 방식을 버린 이유는 **화면이 늘 때 누락이 곧
개인정보 유출**이기 때문이다. 경로 목록 하나면 리뷰가 끝나고, 클래스가 렌더 시점에 DOM에
붙으므로 라우트 전환 타이밍 경합도 없다.

대가로 주문 폼·마이페이지의 리플레이를 못 본다. 리플레이의 도입 근거였던 디자인 생성(`/design`)과
상품 탐색(`/shop`)은 그대로 녹화된다.

## 실측

- **번들**: 엔트리 227.84KB → 228.59KB(gzip 71.70 → 72.03, **+0.33KB**). posthog 본체는
  별도 청크 242KB(gzip ~80KB)로 분리돼 지연 로드된다. 키 없이 빌드하면 청크 자체가 생기지 않는다.
- **로컬 실측**(3010 포트, 키 주입, Aside): `/flags/`·`/i/v0/e/` 요청 정상, 콘솔 오류·경고 0건.
  `/login`에서 `ph-no-capture` 부착, `/shop`에서 미부착 확인.
- **`before_send` 타입 계약**: `@posthog/types@1.405.0` 기준 `before_send`·`defaults: '2026-05-30'`
  모두 유효(`ConfigDefaults`에 존재, 최신은 `'2026-08-29'`).

## 콘솔에서 확인된 것 — 조치 필요

로컬 실측 중 PostHog이 내려준 원격 설정을 읽었다. **리플레이가 이미 켜져 있다.**

| 설정 | 현재 값 | 뜻 |
|---|---|---|
| `sessionRecording` | 활성 | 프로젝트 기본이 on — 배포하면 즉시 녹화된다 |
| `sampleRate` | `null` | **전량 녹화**. 무료 한도는 월 5,000 세션 |
| `masking` | `null` | 프로젝트 레벨 마스킹 없음 — SDK 기본(입력 마스킹)만 |
| `consoleLogRecordingEnabled` | `true` | **콘솔 로그가 리플레이에 남는다** |
| `urlBlocklist` | `[]` | 서버 측 차단 경로 없음(우리는 클라이언트 `ph-no-capture`로 처리) |

`ph-no-capture`가 개인정보 화면을 가리므로 배포해도 주소·연락처가 새지는 않는다. 다만
샘플링과 콘솔 로그 녹화는 사람이 콘솔에서 조정해야 한다 — 플랜에 남겼다.

## 검증하지 못한 것

**CSP는 로컬에서 검증할 수 없다.** `public/_headers`는 Cloudflare 배포 시에만 적용되고 vite
dev·preview 어느 쪽도 읽지 않는다. 특히 `worker-src 'self' blob:` 신설이 리플레이 워커를 살리는지는
**배포 후 DevTools 콘솔에 CSP 위반이 없는지로만 확인된다**. 위반은 콘솔에만 찍히고 SDK는 에러를
던지지 않으므로, "켰는데 녹화가 없다"로 나타난다.

## 콘솔 작업 결과 (같은 날)

사람이 콘솔에서 처리한 것과, 그 과정에서 **이미 되어 있던 것으로 밝혀진 것**:

| 항목 | 결과 |
|---|---|
| PostHog 리플레이 샘플링 | 100% → **10%** |
| GA4 데이터 보존 | 2개월 → **14개월**(이벤트·사용자 모두) |
| GA4 ↔ Search Console 링크 | **2026-04-07에 이미 연결**돼 있었다(URL 프리픽스 `https://essesion.shop/` ↔ 스트림 `essesion`) |
| GA4 라이브러리 Search Console 컬렉션 | **이미 게시**돼 있었다 |
| 네이버 서치어드바이저 | **2026-04-07에 이미 등록**·사이트맵 제출 완료 |

계측 도구를 새로 붙이기 전에 **콘솔에 이미 뭐가 있는지 먼저 확인해야 한다**는 것이 이 건의 교훈이다.
GA4 측정 ID도, Search Console 링크도, 네이버 등록도 전부 이미 있었는데 코드만 보고 "미설정"으로
판단했다. `gh variable list`와 콘솔 확인이 플랜을 쓰기 전에 왔어야 했다.

## 검색 인프라 현황 — 조치하지 않음

계측과 별개로 확인된 사실들. **지금은 아무것도 하지 않는다**, 판단 근거만 남긴다.

- **구글 색인은 되어 있다** — URL 검사에서 "URL이 Google에 등록되어 있음". 다만 Search Console
  실적은 노출 0인데, 이건 색인 문제가 아니라 **첫 프로덕션 배포가 2026-08-14로 5일밖에 안 됐기
  때문**이다. 게다가 그때까지 Bot Fight Mode가 켜져 있어 데이터센터 IP를 차단했고
  (`cloudflare-bot-challenge-2026-08-14.md`), Googlebot도 여기 걸렸을 수 있다. 시간이 해결한다.
- **robots.txt에 `User-agent: *` 그룹이 둘이다** — Cloudflare 관리형 블록(AI 크롤러 차단)이 앞에
  주입되고 `apps/store/public/robots.txt`가 뒤에 붙는다. 구글은 같은 user-agent 그룹을 병합하므로
  문제없고, 네이버 진단도 "수집 가능"으로 통과했다. 다만 Yeti가 첫 그룹만 읽으면 `/my-page`·
  `/order` 등의 `Disallow`가 안 먹을 수 있다. 실제 문제가 확인되면 `User-agent: Yeti` 전용 그룹을
  명시한다.
- **네이버 Yeti의 JS 렌더링 한계** — store는 SPA라 페이지별 제목·설명을 React가 나중에 붙인다.
  Yeti가 그걸 못 읽으면 모든 페이지가 `index.html`의 홈 메타로 수집된다. 네이버 노출이 실제로
  중요해지면 정적 메타 주입(SSR/프리렌더)을 검토한다. 현재 홈 기준 진단은 제목·설명·OG 전부 통과.
- **네이버 소유확인 수단이 지금 사이트에 없다** — 레포·배포본 어디에도 확인 파일/메타태그가 없다.
  4월 등록 당시 이전 사이트에 넣었던 것이 컷오버로 사라졌다. 이미 확인이 끝난 사이트는 서치어드바이저가
  재확인 화면을 제공하지 않으므로 **지금 넣을 수단이 없고, 넣을 필요도 없다.** 목록에서 사이트가
  빠지거나 경고가 뜨면 그때 재등록한다.
- 구글 쪽 소유확인은 GA4 태그 기반으로 보인다(TXT·HTML 태그 모두 없음). `G-1V993D3825`가 살아 있는
  한 유지된다.

## 검사

`pnpm lint`·`pnpm typecheck`·`pnpm --filter store build`·`pnpm architecture:check` 통과.
`product-analytics.test.ts` 4건, `analytics.test.ts` 2건 통과.
