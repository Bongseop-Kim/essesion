# @essesion/shared — 디자인 시스템 하네스

admin·store의 모든 UI는 이 규칙을 따른다. 근거·수치는 `docs/foundation/`(색인은 맨 아래) 참조. 값의 유일한 사전은 `docs/foundation/design-token-reference.md`(= `src/theme.css`).

## 규칙 (위반 금지)

0. **UI 구현 우선순위 사다리 — 표현할 수 없으면 멈춘다**: ① **shared 공통 컴포넌트 1순위**(아래 색인 표에서 먼저 확인, 앱 로컬 재구현 금지) → ② 없으면 프리미티브+토큰 조합 → ③ 그래도 표현 안 되면 임의 값(`bg-[#…]`, `text-[13px]`, inline 색)으로 우회하지 말고 **멈추고 토큰/컴포넌트 추가를 제안**한다(디자인 시스템 리뷰 신호). `pnpm lint`의 `scripts/check-harness.mjs`가 위반을 차단하며, 개별 예외는 줄 끝 `// harness-ignore`(사유 병기)로만.
1. **레이아웃은 프리미티브로만** — `Box` `Flex` `HStack` `VStack` `Grid` `Float`. 레이아웃 목적의 raw `<div>` + Tailwind 레이아웃 클래스(`flex`, `p-4`, `gap-2` 등) 금지.
2. **시각값은 토큰만** — 색 `fg.*`/`bg.*`/`stroke.*`, 간격 `x*`, 라운드 `r*`, 그림자 `s1`–`s3`. prop에 raw 시각 숫자 금지(`p={16}` ✗, `p="x4"` ✓).
   구조값은 숫자 허용: `flex` `zIndex` `columns` `width`/`height`(치수) `borderWidth` Icon `size` `maxLines`.
3. **`palette.*` 직접 사용 금지** — 맞는 시맨틱 토큰이 없으면 임의 값을 쓰지 말고 토큰 추가를 먼저 제안할 것.
4. **Tailwind 기본 팔레트·라운드·그림자·폰트크기는 빌드에서 제거됨**(`--color-*: initial` 등) — `bg-red-500` `rounded-md` `shadow-sm` `text-sm`은 **아무 스타일도 내지 않는다**(빌드 에러 없음, 조용히 죽음). 시맨틱 유틸리티를 쓸 것: `bg-bg-brand-solid` `text-fg-neutral` `border-stroke-neutral` `rounded-r2` `shadow-s1` `text-t4`.
5. **타이포는 `Text` + `textStyle`만** — 임의 `text-[13px]`·fontSize 스타일 금지. heading 시맨틱은 `<Text as="h1" textStyle="title1">`처럼 `as`로 분리.
6. **인터랙티브 컴포넌트**(ActionButton 등 shared 컴포넌트)는 Tailwind variant/size 레코드 + `cn()` 패턴 — 이 패턴 안의 `text-t*` 사용은 규칙 5의 예외. hover/pressed는 시맨틱 `-hover`/`-pressed` 토큰 유틸리티, 포커스는 `focus-visible:outline-stroke-focus-ring`. disabled는 이원화: 버튼류 `opacity-50`, 폼 필드는 `bg.disabled`/`fg.disabled` (state.md).
7. **반응형** — 프리미티브 prop은 `ResponsiveValue`(`p={{ base: "x4", md: "x8" }}`), Tailwind 쪽은 `md:` variant. 브레이크포인트: sm 480 / md 768 / lg 1280 / xl 1440.
8. **같은 속성을 prop과 className 양쪽에 설정 금지** — 프리미티브는 inline style로 렌더하므로 항상 className을 이긴다. 탈출구는 `style` prop(최후순위, resolved보다 나중에 병합).
9. **`theme.css`의 `@theme static`을 제거하지 말 것** — 제거하면 프리미티브가 참조하는 CSS 변수가 tree-shake되어 조용히 무스타일이 된다(드리프트 가드 테스트 + 빌드 후 dist grep이 방어선).
10. **가로 스크롤은 `ScrollFog direction="horizontal"`만 사용** — 가로 scrollbar는 항상 숨긴다. 스크롤 가능 여부는 fog edge로 전달한다. `overflowX="auto|scroll"`·`overflow-x-auto|scroll` 직접 사용 금지(`pnpm lint`가 차단). 세로 스크롤은 모달·시트·패널·긴 목록에서 상황별로 허용하되, PC는 필요하면 scrollbar 표시, 모바일은 공간이 좁으면 `ScrollFog`/시트 패턴으로 edge hint를 우선한다. 상세: `docs/foundation/scroll.md`.

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

## 컴포넌트 색인 (규칙 0의 ①에서 먼저 확인)

| 분류 | 컴포넌트 |
|---|---|
| 레이아웃 프리미티브 | Box · Flex · HStack · VStack · Grid · Float · Text · Icon |
| 앱 셸 | Layout/LayoutContent · Footer(FooterSection/FooterLink) |
| 버튼 | ActionButton(기본 버튼) · ToggleButton · FloatingActionButton · Chip |
| 폼 | Field · TextField · TextAreaField · Checkbox · RadioGroup/RadioGroupItem · Switch · SegmentedControl · SelectBox · FieldButton · **ListPicker**(FieldButton+ResponsiveModal+List 조합 단일 선택) · AttachmentDisplayField |
| 내비게이션 | Tabs(TabList/TabTrigger/TabContent) · Menu(Trigger/Content/Item/Group/Separator) |
| 스크롤 | ScrollFog · PullToRefresh |
| 오버레이 | AlertDialog · Modal · **ResponsiveModal**(모바일 시트↔PC 모달) · BottomSheet · SwipeableMenuSheet(Group/Item) · SidePanel · Snackbar(`snackbar()`/SnackbarHost) |
| 인라인 피드백 | Callout · PageBanner |
| 디스플레이 | Badge · Avatar · TagGroup/Tag · Divider · Skeleton · ProgressCircle · AspectRatio · ImageFrame |
| 콘텐츠 | List(ListItem/ListHeader) · Accordion · Article · ContentPlaceholder · ResultSection |

## 오버레이·피드백 선택 (상세·근거: docs/foundation/overlay.md — 필독)

| 필요 | 사용 |
|---|---|
| 진행 차단 + 확인 1–2버튼 | AlertDialog (바깥 클릭으로 안 닫힘) |
| 임시 작업·폼·상세 (기본 패턴) | **ResponsiveModal** — 모바일 BottomSheet ↔ PC 중앙 Modal 자동 전환 |
| 액션 목록 | SwipeableMenuSheet(모바일) / Menu(데스크톱) |
| 트리거 기준 명령 목록(데스크톱) | Menu |
| 측면 맥락 유지 보조 작업(admin) | SidePanel |
| 수 초 뒤 사라지는 결과 알림 | `snackbar()` — SnackbarHost를 앱 루트에 1회 마운트 |
| 섹션 상주 안내 | Callout |
| 페이지 전체 공지(페이지당 1개) | PageBanner |

- 모달 위 모달 금지. dialog/popover 요소에 display 클래스 금지(overlay.md 구현 계약).
- theme.css 추가는 **토큰과 문서 수준 규칙**(body 스크롤 잠금 등)만 — 컴포넌트 룩 CSS 금지.

## 로딩·빈·에러 상태 선택 (store·admin 공통)

데이터 뷰(목록·상세·폼 등 서버 데이터에 의존하는 화면)는 **로딩·빈·에러 3상태를 항상** 처리한다. 컴포넌트 선택:

| 상황 | 사용 |
|---|---|
| 레이아웃 형태가 정해진 초기 로딩 (목록·카드·상세 본문·프로필) | **Skeleton** — 실제 콘텐츠와 같은 형태·크기로 배치해 레이아웃 시프트를 막는다. 목록은 카드 옆에 스켈레톤을 함께 export해 재사용(예: `ProductCardSkeleton`). |
| 형태를 그릴 수 없는 대기 | **ProgressCircle** — 라우트 가드·세션 부트스트랩, 버튼 인라인 로딩, 이미 콘텐츠가 있는 상태의 "더 보기"·무한스크롤 추가 로딩(형태가 이미 있어 스켈레톤 불필요). |
| 조회 성공·결과 0건, 또는 조회 실패(에러) | **ContentPlaceholder** — 아이콘·제목·(설명·액션). 빈 상태와 에러를 같은 컴포넌트로, 문구로 구분. |

- 초기 로딩의 기본은 **Skeleton**. `ProgressCircle`은 "형태 없음"일 때만.
- 첫 진입에 스피너를 겹치지 말 것(가드 스피너 → 콘텐츠 스피너 이중 노출). 콘텐츠 단계는 Skeleton으로.
- 정적 검사는 없다(누락된 로딩 상태는 regex로 못 잡고, `ProgressCircle` 금지는 정당한 용도까지 오탐) — 이 표가 리뷰 기준.

## 컴포넌트 추가·수정 규칙

- 새 공용 컴포넌트는 **2개 앱 이상에서 쓰일 때만** 여기에 추가. 아니면 앱 로컬에.
- 파일은 `src/components/<kebab-case>.tsx`, `src/index.ts` barrel에 export 추가.
- React 19 관용구: ref는 일반 prop(forwardRef 금지), 타입 임포트는 `import type`(verbatimModuleSyntax).
- 아이콘 에셋은 앱 소유(`@heroicons/react`) — shared는 `<Icon svg={...}/>` 래퍼만. 장식 아이콘은 기본 `aria-hidden`, 의미 전달 시 `aria-label` 부여. 예외: 컴포넌트 구조상 필수 글리프(체크·셰브론·X)는 `src/components/internal/glyphs.tsx`에 둔다 — 콘텐츠 아이콘은 여전히 앱 소유.

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
| overlay | **오버레이·피드백 7종 결정 트리·닫힘 모델·구현 계약** |
| radius / spacing | r·x 스케일 용도 매핑 |
| scroll | 가로 scrollbar 금지, ScrollFog 우선, 세로 스크롤 표시 판단 |
| state | enabled→hover→pressed→selected→disabled→focus-visible |
| voice-and-tone / writing | store·admin 보이스, UI 문구 규칙 |
