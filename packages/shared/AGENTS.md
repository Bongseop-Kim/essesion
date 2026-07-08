# @essesion/shared — 디자인 시스템 하네스

admin·store의 모든 UI는 이 규칙을 따른다. 근거·수치는 `docs/foundation/`(색인은 맨 아래) 참조. 값의 유일한 사전은 `docs/foundation/design-token-reference.md`(= `src/theme.css`).

## 규칙 (위반 금지)

1. **레이아웃은 프리미티브로만** — `Box` `Flex` `HStack` `VStack` `Grid` `Float`. 레이아웃 목적의 raw `<div>` + Tailwind 레이아웃 클래스(`flex`, `p-4`, `gap-2` 등) 금지.
2. **시각값은 토큰만** — 색 `fg.*`/`bg.*`/`stroke.*`, 간격 `x*`, 라운드 `r*`, 그림자 `s1`–`s3`. prop에 raw 시각 숫자 금지(`p={16}` ✗, `p="x4"` ✓).
   구조값은 숫자 허용: `flex` `zIndex` `columns` `width`/`height`(치수) `borderWidth` Icon `size` `maxLines`.
3. **`palette.*` 직접 사용 금지** — 맞는 시맨틱 토큰이 없으면 임의 값을 쓰지 말고 토큰 추가를 먼저 제안할 것.
4. **Tailwind 기본 팔레트·라운드·그림자는 빌드에서 제거됨**(`--color-*: initial`) — `bg-red-500` `rounded-md` `shadow-sm`은 **아무 스타일도 내지 않는다**(빌드 에러 없음, 조용히 죽음). 시맨틱 유틸리티를 쓸 것: `bg-bg-brand-solid` `text-fg-neutral` `border-stroke-neutral` `rounded-r2` `shadow-s1`.
5. **타이포는 `Text` + `textStyle`만** — 임의 `text-[13px]`·fontSize 스타일 금지. heading 시맨틱은 `<Text as="h1" textStyle="title1">`처럼 `as`로 분리.
6. **인터랙티브 컴포넌트**(Button 등 shared 컴포넌트)는 Tailwind variant/size 레코드 + `cn()` 패턴. hover/pressed는 시맨틱 `-hover`/`-pressed` 토큰 유틸리티, 포커스는 `focus-visible:outline-stroke-focus-ring`.
7. **반응형** — 프리미티브 prop은 `ResponsiveValue`(`p={{ base: "x4", md: "x8" }}`), Tailwind 쪽은 `md:` variant. 브레이크포인트: sm 480 / md 768 / lg 1280 / xl 1440.
8. **같은 속성을 prop과 className 양쪽에 설정 금지** — 프리미티브는 inline style로 렌더하므로 항상 className을 이긴다. 탈출구는 `style` prop(최후순위, resolved보다 나중에 병합).
9. **`theme.css`의 `@theme static`을 제거하지 말 것** — 제거하면 프리미티브가 참조하는 CSS 변수가 tree-shake되어 조용히 무스타일이 된다(드리프트 가드 테스트 + 빌드 후 dist grep이 방어선).

## textStyle 10종

| 이름 | 크기/행간 | 굵기 | 용도 |
|---|---|---|---|
| `display1` | 32/42 | 700 | store 히어로 |
| `title1` | 26/35 | 700 | 페이지 제목 |
| `title2` | 22/30 | 700 | 섹션 제목 |
| `title3` | 18/24 | 700 | 카드 제목 |
| `body` | 16/22 | 400 | store 기본 본문 |
| `bodySm` | 14/19 | 400 | admin 기본·테이블 |
| `label` | 16/22 | 500 | 버튼·폼 레이블 |
| `labelSm` | 14/19 | 500 | 작은 레이블 |
| `caption` | 13/18 | 400 | 보조 텍스트 |
| `captionSm` | 12/16 | 400 | 뱃지·타임스탬프 |

## 컴포넌트 추가·수정 규칙

- 새 공용 컴포넌트는 **2개 앱 이상에서 쓰일 때만** 여기에 추가. 아니면 앱 로컬에.
- 파일은 `src/components/<kebab-case>.tsx`, `src/index.ts` barrel에 export 추가.
- React 19 관용구: ref는 일반 prop(forwardRef 금지), 타입 임포트는 `import type`(verbatimModuleSyntax).
- 아이콘 에셋은 앱 소유(`@heroicons/react`) — shared는 `<Icon svg={...}/>` 래퍼만. 장식 아이콘은 기본 `aria-hidden`, 의미 전달 시 `aria-label` 부여.

## docs/foundation 색인

| 문서 | 내용 |
|---|---|
| design-token | 팔레트→시맨틱 2계층 원리, 명명 문법, 다크모드 업그레이드 경로 |
| design-token-reference | **전 토큰 표 (유일한 값 사전)** |
| color-system / color-role / palette | 모노크롬(#111111) 운용 원칙 / 역할 매트릭스·선택 순서 / 스케일 |
| typography | Pretendard, t-스케일, textStyle 레시피 |
| elevation | layer 3단 + s1(카드)/s2(드롭다운)/s3(모달) |
| gradient | 정책: 장식 그라디언트 없음 |
| inclusive-design | APCA 대비 기준, 포커스 링, 클릭 타깃 |
| international-design | 한국어 줄바꿈, ₩·날짜·숫자 표기 |
| layout | store 콘텐츠 / admin 대시보드 레이아웃 |
| motion | duration 3단 × ease 3종 |
| radius / spacing | r·x 스케일 용도 매핑 |
| state | enabled→hover→pressed→selected→disabled→focus-visible |
| voice-and-tone / writing | store·admin 보이스, UI 문구 규칙 |
