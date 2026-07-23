# @essesion/shared — 디자인 시스템 하네스

admin·store의 모든 UI는 이 규칙을 따른다. 근거·수치는 `docs/foundation/`(색인은 맨 아래) 참조. 값의 유일한 사전은 `docs/foundation/design-token-reference.md`(= `src/theme.css`).

사업자 표기: 회사명 `영선산업` · 상호명 `ESSE SION` · 이메일 `biblecookie@naver.com`.

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

## 컴포넌트 트리거 색인 (규칙 0의 ①에서 먼저 확인)

**사용법**: 화면을 짜기 전에 이 표를 스캔한다. 어떤 행의 **트리거**에 해당하는 상황이면 raw 엘리먼트·앱 로컬 재구현이 아니라 **그 컴포넌트를 쓴다**(규칙 0). "피하기"는 흔한 오용과 대신 쓸 컴포넌트다. 오버레이·로딩/빈/에러는 아래 전용 결정 표가 상세 기준이며 여기 행은 진입점이다. 트리거·피하기의 근거는 각 컴포넌트 소스(`src/components/*.tsx`)의 JSDoc과 seed-design 문서를 대조해 작성했고, 충돌 시 소스가 우선이다.

### 레이아웃 프리미티브 (규칙 1 — 레이아웃은 이것들로만)

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Box | 토큰 style prop이 필요한 단일 블록·다형(`as`) 컨테이너. 다른 프리미티브의 기반 | 행/열 배치는 Flex/Stack. raw `<div>`+Tailwind 레이아웃 클래스 |
| Flex | 커스텀 방향/정렬의 1축 배치 | 단순 가로행/세로열은 HStack/VStack |
| HStack / VStack | 가로행(HStack, 기본 `align=center`) · 세로열(VStack) | — |
| Grid | 균등 n열(`columns`) 또는 `templateColumns`로 2차원 배치 | 1축이면 Flex/Stack |
| Float | `position:relative` 부모 위 9개 앵커로 겹쳐 배치(뱃지·FAB·오버레이 위치) | 문서 흐름 배치 |
| Text | **모든 텍스트** — `textStyle`(10종)+`as`로 시맨틱 분리, `maxLines` 말줄임 | raw `text-[13px]`/fontSize, heading 태그에 스타일 직접 |
| Icon | 앱 소유 SVG를 크기·색으로 래핑(`svg` 필수, 기본 24px) | 의미 전달 아이콘은 `aria-label` 부여 |

### 앱 셸

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Layout / LayoutContent | 앱 루트 세로 컬럼(Layout) + 밀도별 최대폭·반응형 거터 콘텐츠 컨테이너(LayoutContent: `density` low 720 / medium 1280 / high 무제한) | 페이지 폭·좌우 거터를 임의 값으로 재작성 |
| Header | 상단 스티키 바(브랜드+주요 nav, 모바일은 우측 슬라이드 메뉴). 링크는 앱이 `renderLink`로 | 앱마다 헤더 재구현 |
| Footer / FooterSection / FooterLink | 하단 푸터 바(구획=FooterSection, 링크=FooterLink) | — |

### 버튼

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| ActionButton | **액션 실행**(제출·저장·이동·삭제·CTA). variant: `brandSolid`=핵심 CTA(화면당 1개) · `neutralWeak`=대부분의 액션 · `neutralOutline`=보조 · `criticalSolid`=되돌릴 수 없는 작업 · `ghost`=최소 강조 · `kakao`/`naver`=소셜 로그인 전용 | 정보/선택 표시(→Chip/Badge). 한 줄에 4개+ 나열, Solid+Outline 혼용 |
| Chip | pill 선택/토글 — 필터·옵션·추천·태그 선택(단일/다중), 탭 대체 | 액션 실행(→ActionButton), 정적 정보(→Badge) |

### 폼 (컨트롤 라벨·설명·에러는 Field가 배선)

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Field | 앱 커스텀 컨트롤에 label·description·errorMessage + `aria-describedby` 배선 | TextField/FieldButton 등 내장 컨트롤은 자체 처리(중복 래핑 X) |
| TextField | 한 줄 텍스트 입력(prefix/suffix, medium/large) | 여러 줄은 TextAreaField |
| TextAreaField | 여러 줄 텍스트 입력(`rows`·`autoResize`) | — |
| Checkbox | 다중/비배타 선택 · 약관 동의 · 부모-자식 옵션 | 즉시 반영(→Switch), 단일 배타(→RadioGroup) |
| RadioGroup / RadioGroupItem | 소수 옵션의 배타적 **단일 선택**(vertical/horizontal) | 옵션 많음(→SelectBox/ListPicker), 다중(→Checkbox), 불리언 즉시(→Switch) |
| Switch | **즉시 반영**되는 on/off | 저장/확인 단계가 필요(→Checkbox) |
| SegmentedControl / SegmentedControlItem | 현재 화면의 콘텐츠를 즉시 필터/전환(2–4개 세그먼트) | 페이지 이동(→Tabs), 5개+ (→Radio/Select) |
| SelectBox / SelectBoxItem | 설명·비교가 필요한 테두리 카드형 옵션(제출로 확정, `multiple`·`columns`) | 가벼운 키워드 필터(→Chip), 클릭 즉시 액션 |
| FieldButton | 입력창처럼 보이는 트리거 — 피커/선택 다이얼로그를 연다(값+셰브론 표시) | 직접 텍스트 입력(→TextField) |
| DatePicker | `YYYY-MM-DD` 날짜 단일 선택(min/max, 오늘·지우기 포함). 모바일 BottomSheet ↔ PC Modal | 앱 로컬 달력·raw `input[type=date]` 재구현 |
| ListPicker | 오버레이 목록에서 **단일 선택**(FieldButton+ResponsiveModal+List 조합) | 옵션 2–3개면 SelectBox/RadioGroup 먼저 |
| AttachmentDisplayField | 이미지 첨부 필드 — 썸네일 표시·제거, `onAddFiles` 지정 시 남은 슬롯에 파일 선택 타일 노출. `max=1`은 선택 후 추가 타일·카운터 숨김 | raw file TextField와 별도 썸네일 UI 조합 |

### 내비게이션

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Tabs / TabList / TabTrigger / TabContent | 한 화면에서 탭 단위로 콘텐츠 분리/전환(Line 스타일). `triggerLayout` hug(기본)/fill | 같은 화면 콘텐츠 조작·필터(→SegmentedControl) |
| Menu (Root/Trigger/Content/Item) | **트리거 요소에 붙는** 선택지/명령 목록. 모바일에서도 같은 컴포넌트를 사용 | 긴 목록·폼(→ResponsiveModal) |
| HelpBubbleTrigger | 버튼을 클릭해 여는 짧은 보조 설명. 여러 문장·모바일 탭·명시적 닫기가 필요한 도움말 | 명령 목록(→Menu), 상주 안내(→Callout), hover 전용 Tooltip |
| Breadcrumb | 페이지 경로 표시(마지막=현재 페이지). 라우팅은 `renderLink` | 단일 뎁스 페이지 |

### 스크롤 (규칙 10)

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| ScrollFog | 스크롤 여지가 있는 가장자리를 알파 마스크로 페이드. **가로 스크롤은 항상 이걸로**(`direction="horizontal"`, scrollbar 숨김) | `overflowX:auto/scroll`·`overflow-x-*` 직접(`pnpm lint`가 차단) |

### 오버레이 (상세 결정 트리: 아래 "오버레이·피드백 선택" 표 — 필독)

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| AlertDialog | 진행 차단 확인(1–2버튼) · 파괴적 결정 — **바깥 클릭으로 안 닫힘** | 단순 결과 알림(→Snackbar) |
| Modal | 일반 중앙 모달(바깥 클릭으로 닫힘, small/medium) | 모바일 포함이면 ResponsiveModal 기본 |
| ResponsiveModal | **임시 작업·폼·상세의 기본 패턴** — 모바일 BottomSheet ↔ PC Modal 자동 전환 | — |
| BottomSheet | 모바일 하단에서 올라오는 시트(현재 맥락 유지). 중요 플로우는 `showCloseButton` | 콘텐츠가 화면 90%↑면 전용 페이지 |
| SidePanel | 측면에서 슬라이드되는 패널(admin 보조 작업·맥락 유지, Header 모바일 메뉴) | — |
| Snackbar (`snackbar()` / SnackbarHost) | 수 초 뒤 사라지는 결과 알림. SnackbarHost는 앱 루트에 1회 마운트 | 입력 필요·지속 경고(→AlertDialog / Callout / PageBanner). 동시 2개+ |

### 인라인 피드백

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Callout | 섹션에 상주하는 안내 블록(tone 5종: neutral/informative/positive/warning/critical, `onClick`=actionable·`onDismiss`=dismissible). **절제해 사용** — 조건 충족 시에만 나타나 조치·주의가 필요한 메시지가 기본, 상주 안내는 결제·환불 제약 같은 필수 고지에 한정 | warning/critical에 dismissible(경고는 닫기 X). 페이지 전체 공지(→PageBanner), 사라지는 알림(→Snackbar), 빈 상태·조회 실패(→ContentPlaceholder), 데이터 콘텐츠 표시(메모·주소 등 → 일반 레이아웃+Text), 폼 도움말·스펙 안내(→Field description·caption Text), 같은 뷰에 상시 2개+ 쌓기(가장 중요한 1개만 남기고 강등) |
| PageBanner | **페이지당 1개** 전체 폭 공지(top/bottom, variant weak/solid × tone) | 페이지당 2개+, 섹션 국소 안내(→Callout) |

### 디스플레이

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| Badge | 정적 상태/속성 텍스트 태그(2–3단어, non-interactive) | 클릭 유도·CTA(→Chip/ActionButton). 객체당 3개+ |
| Avatar | 원형 사용자 아이덴티티 이미지(`name` 이니셜 → 기본 실루엣 폴백) | 비-사용자·장식 이미지(→ImageFrame/Icon) |
| TagGroup / Tag | 인라인 메타데이터 나열(기본 `·` 구분) — 카테고리·속성 | — |
| Divider | 섹션/그룹 사이 구분선(`inset` 여백, orientation) | 반복 목록(자연 구분 있음). 장식용이면 `as="div"` |
| Skeleton | **형태를 아는 초기 로딩**(목록·카드·상세 본문·프로필) — 실제 콘텐츠와 같은 형태·크기로 배치해 레이아웃 시프트 방지. 카드 옆에 `XxxSkeleton`으로 함께 export | ProgressCircle과 같은 화면 동시 노출. 형태를 못 그리는 대기(→ProgressCircle) |
| ProgressCircle | **형태 없는 대기** — 라우트 가드·세션 부트스트랩, 버튼 인라인 로딩, "더 보기"·무한스크롤 추가 로딩(size 16/24/40) | 형태를 아는 초기 로딩(→Skeleton) |
| AspectRatio | 고정 비율 컨테이너로 프레이밍 — 자식은 `absolute inset-0`/`size-full` | 폴백이 필요한 이미지(→ImageFrame) |
| ImageFrame | **모든 콘텐츠 이미지**(상품·업로드) — 비율 프레임+라운드, 누락/실패 시 실루엣 폴백. 오버레이는 children, `fill`로 부모 채움 | raw `<img>`. 장식/배경 이미지(→CSS background-image) |

### 콘텐츠

| 컴포넌트 | 트리거 | 피하기 / 대신 |
|---|---|---|
| List / ListItem / ListHeader | 세로 목록 — ListItem은 `href`/`onClick` 유무로 링크·버튼·정적 행 자동 선택. 구획 제목은 ListHeader | 카드 그리드(→Grid) |
| Accordion | 접이식 목록(`single`/`multiple`, `inline`/`separated`) | — |
| Article | 본문 텍스트 컨테이너(텍스트 선택 허용 + 긴 단어 줄바꿈) | 짧은 UI 라벨은 Text |
| ContentPlaceholder | **조회 0건·에러 상태**(아이콘·제목·설명·액션, 섹션 내 세로 중앙) — 빈 상태와 에러를 문구로 구분 | ⚠ **이미지가 안 뜬 자리 아님**(→로딩은 Skeleton, 이미지 자체는 ImageFrame 폴백). 전체 뷰 대형(→ResultSection) |
| ResultSection | 완료·결과·빈 상태의 **대형 전체 뷰**(에셋+제목+설명+주/보조 액션) | 섹션 안의 작은 빈 상태(→ContentPlaceholder) |

> ⚠ **ContentPlaceholder 주의**: seed-design의 동명 컴포넌트는 "이미지가 로드되기 전 자리 표시"용이지만, 이 레포의 ContentPlaceholder는 **빈/에러 상태** 컴포넌트다. 이미지 로딩 자리에는 Skeleton(또는 ImageFrame의 폴백)을 쓴다.

## 오버레이·피드백 선택 (상세·근거: docs/foundation/overlay.md — 필독)

| 필요 | 사용 |
|---|---|
| 진행 차단 + 확인 1–2버튼 | AlertDialog (바깥 클릭으로 안 닫힘) |
| 임시 작업·폼·상세 (기본 패턴) | **ResponsiveModal** — 모바일 BottomSheet ↔ PC 중앙 Modal 자동 전환 |
| 액션 목록 | Menu — 모바일·데스크톱 공통 |
| 트리거 기준 짧은 보조 설명 | HelpBubbleTrigger |
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
| overlay | **오버레이·피드백 8종 결정 트리·닫힘 모델·구현 계약** |
| radius / spacing | r·x 스케일 용도 매핑 |
| scroll | 가로 scrollbar 금지, ScrollFog 우선, 세로 스크롤 표시 판단 |
| state | enabled→hover→pressed→selected→disabled→focus-visible |
| voice-and-tone / writing | store·admin 보이스, UI 문구 규칙 |
