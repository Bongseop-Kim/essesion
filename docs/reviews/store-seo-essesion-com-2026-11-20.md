# 스토어 검색 노출 개선 실행 결과 (2026-11-20)

`docs/plans/store-seo-essesion-com.md`(삭제)의 절차 1~7을 실행했다. 앞부분은 절차 1(수집 실측), 뒷부분은 절차 2~7의 결과다.

## 수집 실측의 결론

**구글과 네이버 모두 JS 본문을 읽는다.** 프리렌더·SSR 플랜은 쓰지 않는다.

## 구글 (Search Console, `essesion.com` 도메인 속성)

URL 검사의 "실제 URL 테스트"로 렌더링된 HTML을 봤다.

| 주소 | 색인 상태 | 렌더링된 HTML |
|---|---|---|
| `/shop/1` | 아직 미등록, 등록 가능 | h1 있음, 상품명 있음, 링크 29개, canonical 1개. 제품 스니펫·판매자 목록 유효 1개씩(심각하지 않은 문제 있음) |
| `/custom-order` | 등록됨 | h1 있음, 링크 16개, canonical 1개 |

두 주소 모두 메타가 두 벌이다. description 2개, `og:image` 2개(`/shop/1`), 그리고 **`<title>`도 2개**다 — 페이지 제목과
`index.html`의 홈 기본 제목이 함께 남는다. 플랜 절차 2는 description·og 태그만 적었는데 title도 대상이다.

## 네이버

- **실제 검색 결과는 JS 본문을 반영한다.** 네이버에서 `site:essesion.shop`을 검색하면 `/shop`은 제목 "스토어 | 영선산업"에
  상품명·가격이, 상품 상세는 상품명 제목에 상품 코드·소재가, `/custom-order`는 "맞춤 넥타이 제작 주문"에 원단 조합 본문이
  나온다. 전부 JS 실행 뒤에만 있는 내용이다.
- **서치어드바이저의 URL 검사 도구는 원본 HTML만 본다.** `https://essesion.com/shop/1`을 넣으면 제목·설명·Open Graph가 모두
  홈 기본값으로 나온다. 이 도구의 결과로 "네이버가 본문을 못 읽는다"고 판단하면 안 된다.
- `site:essesion.com`은 홈 1건뿐이다. 오늘 등록해서 수집 기록이 없다(요약·사이트 진단·수집 현황 모두 "정보 없음").
- 서치어드바이저에는 `essesion.com`만 등록돼 있다. `.shop`은 등록돼 있지 않아 과거 수집 리포트는 없다.
- 사이트맵이 제출돼 있지 않아 같은 날 `https://essesion.com/sitemap.xml`을 제출했다.

## 한 일 (절차 2~7)

- **메타 두 벌 정리(2)**: `index.html`의 기본 title·description·og에 `data-seo-default`를 붙이고 앱 시작 때 걷어낸다
  (`shared/seo/default-meta.ts`). 기본 title만은 남겨, 페이지가 title을 렌더하지 않는 화면(장바구니·마이페이지 등)에서
  쓴다. `PageMeta`는 description·`og:image`를 항상 렌더한다. 홈과 주문 제작의 손으로 쓴 메타는 `PageMeta`로 바꿨다.
- **사이트맵(3)**: `worker.ts`가 `/sitemap.xml`을 만든다 — 고정 주소 11개 + 상품 API의 `/shop/<id>`. API가 실패하면
  고정 주소만 준다. `public/sitemap.xml`은 지웠다.
- **공유 미리보기용 메타(4)**: `worker.ts`가 공개 페이지 HTML의 `<!--seo-->` 구간을 경로별 title·description·canonical·og로
  바꾼다. 상품 상세는 상품 API(제한 1.5초)에서 이름·설명·이미지를 가져오고, 실패하면 원본 HTML을 그대로 준다. 문구는
  `shared/seo/site-meta.ts` 한 곳에 모아 페이지와 Worker가 함께 쓴다.
- **상품 설명(5)**: admin에서 7개 상품의 설명을 넣었다. 폭·혼용률은 값을 몰라 넣지 않았다. 이름·사진·색상 값이
  어긋난 4개도 맞췄다 — 7번 이름에 "와인" 추가, 5번 색상 네이비→그레이, 2번 이름·색상을 네이비로, 3번 이름을
  그레이→블랙으로. 2·3번은 사진만 보고 정한 것이다.
- **상호 표기(6)**: 상호는 영선산업, 브랜드는 ESSE SION으로 둘 다 쓴다(운영자 확인). title 접미사는 "영선산업"으로
  통일하고(9개 페이지 수정) 상품 brand와 본문의 ESSE SION은 그대로 뒀다.
- **`/design`(7)**: 7월에 AI 디자인 대화 화면이던 때 막은 것이 템플릿 목록으로 바뀐 뒤에도 남아 있었다. robots.txt를
  `/design/`(편집 화면)만 막도록 좁히고 템플릿 목록에 canonical을 넣고 사이트맵에 추가했다.

## 플랜과 달랐던 점

- Worker를 모든 HTML이 아니라 공개 페이지 경로에만 먼저 태웠다(`wrangler.jsonc`의 `run_worker_first`). 비공개 화면과
  정적 자산은 Worker 호출 없이 응답한다. 공개 페이지를 새로 만들면 `site-meta.ts`와 `run_worker_first` 두 곳에 넣어야 한다.
- 기본 title은 지우지 않고 대체용으로 남겼다. title이 없는 화면이 18개라 지우면 탭 제목이 비기 때문이다.

## 검증

- `pnpm --filter store test`(Worker 테스트 4개 추가, mp4 Range 테스트 유지), `pnpm lint`, `pnpm typecheck`.
- 빌드 결과를 `wrangler dev`로 띄워 확인: `/shop/1` 원본 HTML에 상품명 title·상품 이미지 `og:image`·canonical, 사이트맵에
  상품 7개, 브라우저에서 `/faq`·`/`의 title·description·`og:image`·canonical이 하나씩, `/login`은 기본 title.

## 확인하지 못한 것

- 배포 뒤 운영에서의 확인 — 메신저에 상품 링크를 붙여 미리보기에 상품 사진이 뜨는지, 플러그인 재렌더링
  (`render_page.py https://essesion.com/shop/1`)으로 메타가 한 벌인지. 사이트맵은 주소가 그대로라 다시 제출할 필요가 없다.
- 효과(노출·클릭)는 4주 뒤 Search Console과 서치어드바이저에서 본다. 도메인 전환과 시기가 겹쳐 원인을 단정할 수 없다.

- 구글의 "크롤링된 페이지"(실제 색인본)는 보지 않았다. 실제 URL 테스트의 렌더링 결과로 대신했다.
- 네이버가 `.com` 주소를 `.shop`처럼 본문까지 색인하는지는 수집이 쌓인 뒤에야 볼 수 있다.
