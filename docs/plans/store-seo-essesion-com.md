# 스토어 검색 노출 개선 (essesion.com)

`essesion.com` 스토어의 검색·공유 노출을 고친다. 2026-11-18에 claude-seo 플러그인(v2.6.2)으로
`essesion.com`의 홈, `/shop`, `/shop/1`, `/custom-order`, `/reform`, 없는 주소 한 곳을 렌더링해
점검한 결과를 근거로 한다. 도메인 전환 PR #112가 머지된 뒤에 실행한다.

## 왜 필요한가

점검에서 이미 잘 돼 있는 것과 문제인 것이 갈렸다.

잘 돼 있는 것(손대지 않는다): 페이지별 title·canonical, 홈의 Organization·WebSite 구조화 데이터,
상품 상세의 Product·Offer 구조화 데이터, 없는 주소의 `noindex`, 이미지 `alt`, http→https와
www→루트 301.

문제인 것:

1. **JS를 실행하지 않으면 본문이 비어 있다.** 원본 HTML에는 단어 0개, 링크 0개, h1 없음,
   canonical 없음이고 title·description은 모든 주소가 홈 기본값이다(`/shop` 실측: 렌더링 후
   단어 191개·링크 30개가 전부 JS 실행 뒤에만 나타남). 구글은 JS를 실행하므로 색인은 되지만,
   링크 미리보기를 만드는 스크래퍼는 JS를 실행하지 않는다. 그래서 상품 링크를 메신저로 공유하면
   어느 상품이든 홈 제목과 기본 이미지가 뜬다. 네이버 검색로봇(Yeti)이 JS 실행 후 본문을
   읽는지는 자료가 엇갈려 **확인하지 못했다**. 절차 1이 이것을 실측한다.
2. **description·og 태그가 두 벌이다.** `apps/store/index.html:8-21`의 기본 메타와 페이지가
   덧붙이는 메타가 함께 남는다. 렌더링된 `/shop/1`에는 description이 2개, `og:image`가 2개,
   `og:type`이 `website`와 `product`로 2개다. 검색엔진이 어느 쪽을 쓸지 정해져 있지 않다.
3. **사이트맵에 상품이 없다.** `apps/store/public/sitemap.xml`은 손으로 쓴 10개 주소뿐이고
   `/shop/1`~`/shop/7`이 빠져 있다. 상품을 추가해도 사이트맵은 그대로다.
4. **상품 description이 상품명과 같다.** `/shop/1`의 description은 "프리미엄 스트라이프 울블랜드
   네이비"로 title과 같은 문구다. `apps/store/src/pages/shop/detail.tsx:297`이 `product.info`를
   그대로 쓰는데 그 값이 상품명 수준이다. 구조화 데이터의 description(`detail.tsx:67`)도 같다.
5. **상호 표기가 섞여 있다.** title 접미사가 페이지에 따라 "영선산업"과 "ESSE SION"으로 갈리고,
   `og:site_name`은 "영선산업", 상품 brand는 "ESSE SION"이다.
6. **`/design`이 통째로 수집 차단이다.** `apps/store/public/robots.txt`가 `/design`을 막는다.
   편집 화면(`customize.tsx:699`)은 이미 `noindex`인데 템플릿 목록(`templates.tsx`)까지 막혀
   있다. 홈이 이 페이지로 링크한다.

측정하지 못한 것: 성능(Core Web Vitals). PageSpeed API가 키 없이 결과를 주지 않았다. 검색어·
노출·클릭 실측도 이 플랜에 없다. Search Console과 서치어드바이저는 2026-04-07부터 가동 중이지만
(`docs/analytics.md`) 에이전트가 접근할 수 없다.

## 범위 밖

- `.shop`→`.com` 문자열 교체(canonical, 사이트맵, robots, og:image 주소)는 PR #112와
  `docs/plans/domain-move-essesion-com.md`가 한다. 여기서 다시 하지 않는다.
- SSR 전환과 전체 프리렌더는 하지 않는다. 절차 1에서 네이버가 본문을 읽지 못하는 것이 확인되면
  별도 플랜으로 쓴다.
- 키워드 조사, 콘텐츠(블로그·가이드) 제작, 백링크는 다루지 않는다.
- 없는 주소가 404 대신 200으로 응답하는 것은 고치지 않는다. `noindex`가 이미 붙어 있다.

## 실행 조건

- PR #112가 머지되고 `.shop`→`.com` 301 전환(도메인 플랜 D단계, 기한 2026-11-27)이 끝난 뒤에
  실행한다. 같은 파일(`index.html`, `page-meta.tsx`, `home/index.tsx`, `detail.tsx`,
  `sitemap.xml`, `robots.txt`)을 고치기 때문이다. 머지 전이면 실행하지 말고 기다린다.
- 절차 1은 예외다. 코드를 건드리지 않으므로 지금 바로 할 수 있다.
- 절차 5·6·7은 운영자 결정이나 입력이 있어야 한다. 없으면 건너뛴다.

## 절차

효과 ÷ 난이도 순이다. 위에서부터 실행한다.

1. **수집 실측 (운영자, 코드 변경 없음).** Search Console의 URL 검사로 `/shop/1`과
   `/custom-order`의 "크롤링된 페이지" HTML에 본문이 있는지 본다. 서치어드바이저에서 같은 두
   주소의 수집·색인 상태와 검색 결과에 표시되는 제목·설명을 본다. 네이버 쪽 제목이 홈 기본값
   이거나 본문이 비어 있으면 "네이버가 JS 본문을 읽지 못한다"로 기록한다. 근거: 프리렌더를
   할지 말지가 이 결과에 달려 있다. 결과는 `docs/reviews/`에 적는다.
2. **기본 메타 두 벌 정리.** `apps/store/src/shared/seo/page-meta.tsx`가 description과
   `og:image`를 항상 렌더하게 하고(값이 없으면 기본값), 앱 시작 시(`apps/store/src/main.tsx`)
   `index.html`에서 온 description·og 태그를 지운다. `home/index.tsx:42-51`과
   `custom-order/index.tsx:371-375`의 손으로 쓴 메타는 `PageMeta`로 바꾼다. `index.html`의
   기본값은 JS를 실행하지 않는 스크래퍼용으로 그대로 둔다. 근거: 렌더링 후 태그가 한 벌만 남아야
   검색엔진이 페이지별 값을 쓴다.
3. **사이트맵에 상품 추가.** `apps/store/worker.ts`가 `/sitemap.xml` 요청을 받아 고정 주소
   목록에 공개 상품 목록 API의 `/shop/<id>`를 더해 XML로 응답하게 한다.
   `apps/store/wrangler.jsonc`의 `run_worker_first`에 `/sitemap.xml`을 넣고
   `apps/store/public/sitemap.xml`은 지운다. API 호출이 실패하면 고정 주소만 응답한다.
   근거: 상품이 늘어도 사람이 사이트맵을 고칠 필요가 없다. 기존 공개 API만 쓰므로
   `docs/api-spec/` 변경은 없다.
4. **공유 미리보기용 메타 주입.** `apps/store/worker.ts`가 HTML 응답에 경로별 title·
   description·canonical·og 태그를 넣는다. `/shop/<id>`는 상품 API에서 이름·이미지를 가져오고,
   나머지 경로는 페이지와 같은 문구를 쓴다. 문구는 `apps/store/src/shared/seo/`에 한 곳으로
   모아 Worker와 페이지가 함께 가져다 쓴다. 근거: JS를 실행하지 않는 스크래퍼에 페이지별 값을
   주는 가장 작은 방법이다. 본문은 넣지 않는다. 절차 2의 "시작 시 지우기"가 이 태그도 함께
   지우므로 두 벌 문제가 다시 생기지 않는다.
5. **상품 설명 입력 (운영자).** admin에서 상품 7개의 `info`에 소재·폭·용도를 담은 한두 문장을
   넣는다. 코드는 바꾸지 않는다. 근거: 검색 결과 설명과 구조화 데이터가 모두 이 값을 쓴다.
6. **상호 표기 통일 (운영자 결정 필요).** title 접미사를 "영선산업"과 "ESSE SION" 중 하나로
   정한다. 정해지면 `apps/store/src`의 `<title>` 문구(`route-error.tsx:19`,
   `not-found/index.tsx:9`, `my-page/*` 등)와 `index.html`의 `og:site_name`을 맞춘다. 결정이
   없으면 실행하지 않는다.
7. **`/design` 템플릿 목록 수집 허용 (운영자 결정 필요).** 허용하기로 하면
   `apps/store/public/robots.txt`의 `Disallow: /design`을 편집 화면 경로만 막도록 좁히고,
   `apps/store/src/pages/design/templates.tsx:53`에 `PageMeta`로 description과 canonical을
   넣고, 절차 3의 고정 주소에 추가한다. 편집 화면의 `noindex`는 그대로 둔다.

## 검증

- 두 벌 정리: 플러그인으로 다시 렌더링해 description과 `og:image`가 하나씩인지 본다.
  `~/.claude/plugins/cache/agricidaniel-claude-seo/claude-seo/2.6.2/scripts/claude-seo run render_page.py https://essesion.com/shop/1 --mode auto --json`
- 사이트맵: `curl -s https://essesion.com/sitemap.xml`에 `/shop/1`이 있고 주소가 전부
  `essesion.com`이다. Search Console과 서치어드바이저에 다시 제출해 오류가 없는지 본다.
- 메타 주입: `curl -s https://essesion.com/shop/1`의 원본 HTML에 상품명 title과 상품 이미지
  `og:image`가 있다. 메신저에 상품 링크를 붙여 미리보기에 상품 사진이 뜨는지 본다.
- Worker 변경은 `apps/store/worker.test.ts`에 테스트를 더하고 `pnpm --filter store test`로
  돌린다. mp4 Range 응답이 그대로인지도 같은 테스트로 본다.
- `pnpm lint`, `pnpm typecheck`, `pnpm architecture:check`.
- 효과: 실행 4주 뒤 Search Console 실적과 서치어드바이저 리포트에서 상품 주소의 노출·클릭을
  실행 전과 비교한다. 도메인 전환과 시기가 겹치므로 변화의 원인을 이 플랜으로 단정하지 않는다.

## 되돌리는 법

Worker 변경(절차 3·4)은 모든 HTML 응답 경로에 들어간다. 배포 뒤 페이지가 열리지 않거나 응답이
눈에 띄게 느려지면 `worker.ts`와 `wrangler.jsonc`를 되돌리고 `public/sitemap.xml`을 복원한다.
상품 API가 느릴 때 HTML 응답까지 기다리게 되는 것이 위험이므로, API 호출에 짧은 제한 시간을
두고 넘기면 기본 메타로 응답한다.

## 실패 모드

절차 1의 실측 없이 프리렌더나 SSR부터 만드는 것, 그리고 플러그인의 렌더링 점검 결과를 검색
순위 영향으로 포장하는 것이 이 플랜의 실패 모드다. 점검은 "크롤러가 무엇을 보는가"만 알려 준다.

## 기각한 대안

- **SSR 또는 전체 프리렌더** — 스토어는 정적 자산으로 배포하는 SPA(`ARCHITECTURE.md` §2)이고
  구글은 지금도 본문을 읽는다. 절차 1에서 네이버가 본문을 읽지 못하는 것이 확인되면 재론한다.
- **검색엔진에만 렌더링된 HTML을 주는 동적 렌더링** — 구글이 우회책일 뿐 권장하지 않는다고
  밝힌 방식이다([Google 검색 센터](https://developers.google.com/search/docs/crawling-indexing/javascript/dynamic-rendering?hl=ko)).
- **빌드할 때 사이트맵 생성** — 빌드가 운영 API에 의존하게 되고, 상품을 추가할 때마다 다시
  배포해야 한다.
- **`index.html`의 기본 메타 삭제** — 두 벌 문제는 없어지지만 Worker 주입이 실패했을 때
  스크래퍼가 아무 메타도 받지 못한다.
