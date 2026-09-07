# 디자인 페이지 첫 진입 안내를 코치마크로 교체하고 실사화 버튼을 입력창으로 옮긴다

`/design` 첫 진입 시 뜨는 2쪽 모달(날염·선염 설명)을 제거하고, 화면의 실제 버튼·패널을 순서대로
가리키며 사용법을 알려주는 코치마크(step tour)로 바꾼다. 같은 작업에서 **실사화 버튼을 입력창의
"아이디어 받기" 자리로 옮기고 아이디어 기능은 폐기**한다. `feat/coachmark` 브랜치에서 실행한다.
서버·API 변경은 없다.

2026-09-07 논의에서 확정한 사항만 적었다. 논의에 쓴 목업(Artifact "디자인 코치마크 목업")은
**스펙이 아니다** — 이력 카드 등 목업의 패널 모양은 실제와 다르며, 이 문서에 없는 목업 요소는 반영하지
않는다. 화면 요소의 정본은 항상 현재 코드다.

## 왜 필요한가

- 현재 `apps/store/src/features/design/ui/onboarding-dialog.tsx`는 인쇄 방식(날염·선염) 개념만
  설명한다. 이 정보는 디자인 페이지의 조작과 무관해졌고, 사용자가 처음 마주치는 화면(입력창·모티프
  패널·이력 카드·미리보기 전환·툴 레일·토큰)은 어디에도 안내가 없다.
- 2026-08~09 사이 기능이 늘었다 — 모티프 슬롯(검색·AI 생성·SVG 업로드), 편집 이력 되돌리기,
  넥타이/타일 미리보기, 실사화·내려받기, 내 디자인·완성본 목록. 실사용 점검
  (`docs/reviews/design-page-aside-2026-09-07.md`, `design-intent-fixes-2026-09-07.md`)은 기능 동작을
  다뤘고 **처음 온 사용자가 이 기능들을 발견하는지는 측정한 적이 없다**(추정: 발견 못 한다).
- **실사화는 이 페이지의 목적지(유료 완성 단계)인데 툴 레일의 5개 원형 아이콘 중 하나**라
  (`tool-rail.tsx:47-53`) 내려받기와 같은 무게로 읽힌다. 이미 노출된 버튼이 많아 레일 안에서 키우거나
  화면에 버튼을 더하는 방식은 소음만 늘린다 — 자리를 바꿔 위계를 세운다.
- "아이디어 받기"(`prompt-bar.tsx:139-149`, `ideas-modal.tsx`)는 사용 근거가 없고 입력창의 가장 좋은
  자리를 차지한다. 폐기하고 그 자리를 실사화에 준다.

## 범위 밖 (non-goals)

- 날염·선염 설명을 다른 곳으로 옮기지 않는다. `finalize-dialog.tsx`의 "선염" 문구는 건드리지 않는다.
- 코치마크·실사화 점등 계측(GA4·PostHog)은 넣지 않는다 — 이벤트 추가는 `docs/analytics.md` 규약과
  함께 별도 플랜에서.
- shared에 공용 Coachmark 컴포넌트를 추가하지 않는다(`packages/shared/AGENTS.md` "2개 앱 이상"
  규칙). store 로컬로 만든다.
- 백엔드 `/design/ideas` 엔드포인트(`packages/api-client/src/sdk.gen.ts:1234`)는 이번에 지우지 않는다.
  `docs/api-spec/` 정본 변경이라 별도 제안으로 다룬다. 프론트 호출만 제거한다.
- 실사화 완료 후 흐름은 바꾸지 않는다 — 이미 완료 시 스낵바를 띄우고 완성본 모달을 연다
  (`use-design-output.ts:140`, `pages/design/index.tsx:174-184`).
- 전송 버튼의 활성/비활성 규칙은 그대로다(`prompt-bar.tsx:156`, 빈 입력이면 disabled).

## 실행 조건

- `pnpm --filter store dev`가 :3000에 떠 있어야 브라우저 검증이 가능하다(떠 있으면 재실행 금지).
- 실행하면 안 되는 조건: `design-canvas.tsx`의 슬롯 구조를 바꾸는 작업이 동시에 진행 중이면 끝날 때까지
  기다린다 — 코치마크는 슬롯에 놓인 요소의 위치를 읽는다.

## 설계 결정 (실행자가 다시 고민하지 않도록)

### 코치마크

- **구현**: 타깃 요소에 `data-coach="<key>"`를 붙이고, 컴포넌트가 현재 스텝의 요소를 `querySelector`로
  찾아 `getBoundingClientRect()`로 위치를 잰다. 말풍선은 `position: fixed` 한 개, 스포트라이트는 타깃
  크기의 빈 박스에 큰 `box-shadow`(`bg.overlay` 토큰, `theme.css:163`). `resize` 리스너 하나로 재측정.
  `// ponytail: rect 측정 방식. CSS anchor positioning으로 옮길 이유는 스텝이 스크롤 컨테이너 안으로
  들어갈 때뿐`
- **타깃이 없거나 숨겨진 스텝은 건너뛴다**(`el.checkVisibility?.() ?? el.offsetParent !== null`). 이
  한 규칙으로 PC/모바일·로그인·디자인 유무 차이를 흡수한다.
- **저장은 기존 `onboarding.ts`**, 키 값만 `design:onboarding:v1` → `design:coachmark:v1`. 옛 키는
  이관하지 않는다(기존 사용자도 새 안내를 한 번 본다). 함수명은 유지.
- **자동 시작**: `restoring`이 끝난 뒤, 다른 오버레이가 없을 때. 진행 중 오버레이가 열리면 닫는다.
- **닫힘**: `건너뛰기`·마지막 `완료`·Esc 모두 완료로 기록(기존 정책 `design-overlays.tsx:197`).
  배경 클릭은 무시(딤 아래 버튼 오클릭 방지).
- **다시 보기 진입점은 툴 레일의 "사용법" 항목**. 캔버스 좌상단 `Help` 버튼(`index.tsx:300-308`)은
  제거한다 — 첫 방문엔 자동으로 뜨므로 상시 버튼일 필요가 없고, 레일에서 실사화가 빠진 자리에 들어가
  노출 버튼 수가 늘지 않는다.
- **비는 좌상단은 미리보기 토글로 채운다(사용자 결정: 빈 자리로 두지 않는다).** `topStart`에
  `ViewToggle`, `topEnd`에 `TokenPill`만. 지금 `topEnd`(`index.tsx:310-332`)는 토큰 pill을 모바일에서
  `position: absolute; top: x12`로 토글 아래에 세로로 쌓는데, 토글이 왼쪽으로 가면 이 꼼수가 필요 없어져
  같이 지운다. 코치마크 스텝 순서는 그대로(미리보기 → 토큰)이고 위치만 좌→우로 바뀐다.
- **접근성**: 말풍선 `role="dialog"` + `aria-labelledby`/`aria-describedby`, 열릴 때 `다음`으로 포커스,
  닫힐 때 시작 버튼(레일 "사용법")으로 복귀. 룩은 `help-bubble.tsx:80`의 inverted 표면·토큰만.

### 실사화 버튼

- **자리**: `prompt-bar.tsx:139-149`의 아이디어 버튼을 그대로 실사화 버튼으로 바꾼다. 아이콘은
  `SparklesIcon`(이미 import돼 있다) — "AI가 만든다"는 뜻이 학습돼 있고, 아이디어 기능이 사라지면 이
  자리의 유일한 별이다. PC(md~)는 `iconOnly=false`로 "실사화" 라벨을 붙이고 모바일은 아이콘만.
- **색은 그라디언트 예외(사용자 결정)**: 실사화는 `brandSolid`가 아니라 **전용 그라디언트**를 쓴다.
  모노크롬 시스템에서 색이 있는 유일한 버튼이라 그 자체가 위계고, 전송 버튼은 그대로 둔다.
  `gradient.md`의 "장식 그라디언트 금지"에 대한 **기능성 예외**로 다룬다 — 스크림(`bg.image-scrim`)과
  같은 방식으로 토큰을 먼저 추가하고 그 토큰만 소비한다. 임의 색으로 조립하지 않는다.
  - 토큰: `theme.css`의 image-scrim 블록(`:165-168`) 아래에 `--color-bg-ai-start/mid/end` 3개와
    주석("실사화 버튼 전용 기능성 그라디언트, gradient.md 예외"). **확정값(사용자 결정 A)** =
    `#4338ca` → `#7c3aed`(55%) → `#db2777`, 135deg. 흰 글자·아이콘 대비는 세 색 모두 4.5:1 이상.
  - 유틸리티: `theme.css` `@layer utilities`의 `.scrim-*`(`:294-325`) 옆에 `.bg-ai-gradient`
    (`background-image: linear-gradient(135deg, var(--color-bg-ai-start), var(--color-bg-ai-mid) 55%,
    var(--color-bg-ai-end))`).
  - 버튼: `action-button.tsx:8-17`의 `variants` 레코드에 `ai` 변형 1줄 추가(`bg-ai-gradient
    text-fg-contrast border-transparent` + hover/pressed는 `brightness` 대신 기존 `-hover` 관례가 없으므로
    `opacity-90`/`opacity-80`). shared 컴포넌트에 변형을 더하는 것이라 "2개 앱 이상" 규칙의 새 컴포넌트가
    아니다. 문서: `gradient.md`에 예외 문단, `design-token-reference.md`에 토큰 3행,
    `packages/shared/AGENTS.md` 버튼 표 `ai` 변형 = "AI 실행 1개(실사화 전용)".
  - 비활성(디자인 없음·busy)은 그라디언트 없이 `neutralOutline` 룩 → 활성화 시 그라디언트가 차오른다.
    점등 연출의 첫 프레임이 이 전환이다. 그라디언트는 transition이 안 되므로 opacity로 전환한다.
- **활성 조건**: 기존 `canFinalize = hasDesign && !busy`(`index.tsx:399`) 그대로. 비활성은
  ActionButton 규칙대로 `opacity-50`. 클릭은 기존과 같이 `ensureAuth() && setOverlay("finalize")`.
- **점등 연출(처음 1회)**: 세션에서 `canFinalize`가 처음 `false→true`가 되는 순간에만 재생한다.
  순서 — 색이 차고(기본 transition 200ms) → 1.12배 튀었다 돌아오고(480ms) → 링이 퍼지고(640ms) →
  하이라이트가 한 번 훑는다(720ms). 별 아이콘은 작게 돌며 커진다(360ms). 총 1초 남짓.
  이후 수정 결과마다 다시 활성화될 때는 색만 돌아온다(하루 수십 번 보는 전환이라 연출 없음).
  `prefers-reduced-motion`이면 색 전환만. keyframes는 `apps/store/src/index.css`에 두고(`:28-60`의
  `login-emoji-enter`·`result-emoji-*`와 같은 자리) `data-ignite` 속성으로 켠다 —
  `motif-panel-hint[data-highlighted]`(`index.css:84-95`)와 같은 패턴.
- **코치마크는 실사화 스텝을 두지 않는다.** 점등 연출이 발견을 맡고, 입력창 스텝 문구에서 한 줄만
  언급한다.

## 스텝 (순서 고정, 문구는 이 표가 정본)

| # | key | 타깃 (`data-coach` 부착 위치) | 제목 | 설명 |
|---|---|---|---|---|
| 1 | `starter` | `starter-gallery.tsx` 루트 (디자인 없을 때만 존재) | 예시로 바로 시작 | 마음에 드는 예시를 누르면 그 디자인에서 바로 이어서 수정할 수 있어요. |
| 2 | `prompt` | `prompt-bar.tsx` 입력창 컨테이너 전체(`Flex as="form"`) | 문장으로 만들고 고쳐요 | 원하는 넥타이를 적으면 디자인이 만들어져요. 만든 뒤엔 "줄만 버건디로"처럼 바꿀 부분만 적어요. 만들어진 뒤엔 오른쪽 실사화 버튼이 켜져요. |
| 3 | `motifs` | `motif-panel.tsx:106` 패널 루트 | 그림(모티프) 넣기 | 슬롯을 눌러 카탈로그에서 고르거나, AI로 만들거나, 내 SVG를 올려요. 최대 2개까지 넣을 수 있어요. |
| 4 | `history` | `history-card.tsx:67` 카드 루트 | 언제든 되돌리기 | 수정할 때마다 단계가 쌓여요. 이전 단계를 누르면 그 디자인으로 돌아가요. |
| 5 | `view` | `view-toggle.tsx:24` 토글 (SegmentedControl이 속성을 못 받으면 감싸는 `Box`에) | 넥타이로, 타일로 | 넥타이에 입힌 모습과 원단 반복 무늬를 번갈아 확인해요. |
| 6 | `tokens` | `token-pill.tsx:68` 잔액 버튼 (로그인 시에만 존재) | 토큰 잔액 | 생성·수정·모티프 생성마다 토큰이 쓰여요. 누르면 항목별 비용과 충전 버튼이 보여요. |
| 7 | `tools` | PC: `tool-rail.tsx:94` nav 루트 / 모바일: `prompt-bar.tsx:112-124` + 버튼 (같은 key, 보이는 쪽만 잡힘) | 내려받기와 목록 | 완성한 디자인을 내려받거나, 내 디자인·완성본 목록을 열거나, 새로 시작해요. 이 안내도 여기서 다시 볼 수 있어요. |

문구는 `packages/shared/docs/foundation/voice-and-tone.md`·`writing.md` 기준. 실행 시 화면 라벨이
바뀌어 있으면 표가 아니라 화면 라벨을 따른다. 비로그인 PC는 6스텝(토큰 없음), 디자인이 있는 상태에서
다시 보기는 6스텝(갤러리 없음)이다.

## 절차

1. **스텝 정의 모델** — `apps/store/src/features/design/model/coach-steps.ts` 신규. 위 표를
   `{ key, title, description }[]` 상수 하나로. 셀렉터는 key에서 유도.
2. **저장 키 교체** — `onboarding.ts:3` 키 값을 `design:coachmark:v1`로. `onboarding.test.ts:26`은 상수
   참조라 그대로 통과.
3. **코치마크 컴포넌트** — `apps/store/src/features/design/ui/coach-mark.tsx` 신규. props `open`,
   `onClose`. 내부 상태 `step` 하나. 타깃 없으면 다음 스텝, 모두 없으면 `onClose`. 딤+스포트라이트 1개,
   말풍선 1개(`Text` 제목·설명, 점 진행 표시, `건너뛰기`·`이전`·`다음/완료` `ActionButton`). 배치는
   타깃 아래 우선, 부족하면 위, 좌우는 뷰포트 안으로 clamp. Esc는 `keydown` 리스너 하나.
4. **타깃 마킹** — 표의 7곳에 `data-coach`. `Box`는 rest props를 DOM에 전달한다(`box.tsx:17`).
   `tools`는 PC nav와 모바일 + 버튼 양쪽에.
5. **실사화 버튼 이동** — `prompt-bar.tsx`:
   - **먼저 토큰·변형** — `theme.css`에 `--color-bg-ai-*` 3개와 `.bg-ai-gradient`, `action-button.tsx`에
     `ai` 변형, `gradient.md`·`design-token-reference.md`·`packages/shared/AGENTS.md` 갱신(위 "색" 결정).
     shared 변경이므로 `pnpm --filter @essesion/shared test`(theme 드리프트 가드)까지 통과시킨 뒤 store로.
   - `:139-149` 아이디어 버튼을 실사화 버튼으로. props `onOpenIdeas` 제거, `onFinalize`·`canFinalize`
     추가. `aria-label="실사화"`, `variant={canFinalize ? "ai" : "neutralOutline"}`,
     `disabled={!canFinalize}`, PC 라벨 표시. 전송 버튼(`:150-160`)은 건드리지 않는다.
   - 점등: `useRef`로 직전 `canFinalize`를 기억해 `false→true` 첫 전환에 `data-ignite="true"`를 1초 뒤
     해제. keyframes는 `index.css`에.
   - `prompt-bar.test.tsx:21` `onOpenIdeas` 픽스처를 새 props로.
6. **아이디어 기능 제거** — `ideas-modal.tsx` 삭제. `design-overlays.tsx:34,45,74,219-225`의 import·
   `"ideas"` 오버레이명·`prompt`/`onPromptChange`/`onRequestIdeas` props·렌더 제거.
   `pages/design/index.tsx:411`(`onOpenIdeas`)·`:443-446`(`createDesignIdeas` 호출과 import) 제거.
   `SparklesIcon` import는 실사화가 이어 쓴다.
7. **툴 레일 개편** — `tool-rail.tsx:39-75`: `finalize` 항목 제거(props `onFinalize`·`canFinalize` 제거),
   `tools` 열 끝에 `help`("사용법", `LightBulbIcon`, `onHelp`) 추가. 레일은 내려받기 / 내 디자인·완성본·
   새로 시작·사용법 5개로 유지. `index.tsx:392-403`의 prop 전달을 맞추고 `:300-308` `topStart` Help
   버튼을 제거(`LightBulbIcon` import는 레일로 이동).
   **상단 재배치** — `topStart`에 `<ViewToggle …/>`를 넣고, `topEnd`(`:310-332`)는 `authenticated`일 때
   `TokenPill`만 남긴다. 감싸던 `Flex position="relative"`와 `Box position={{ base: "absolute" }} top="x12"`
   래퍼는 삭제(토글이 없으니 세로 쌓기 불필요). `ViewToggle` 이동으로 좌상단이 비지 않는다.
8. **페이지 배선** — `index.tsx`:
   - `:86-88` 초기 `overlay`의 `"onboarding"` 분기 제거, `coachOpen` 상태 추가. `restoring`이 `false`로
     바뀌는 시점에 `!isDesignOnboardingComplete() && overlay === null`이면 열기. `overlay`가 열리면
     닫기(같은 effect).
   - `PromptBar`에 `onFinalize={() => ensureAuth() && setOverlay("finalize")}`·
     `canFinalize={hasDesign && !busy}` 전달. `ToolRail`에 `onHelp={() => setCoachOpen(true)}`.
   - `<CoachMark open onClose={() => { completeDesignOnboarding(); setCoachOpen(false); }} />`를
     `DesignOverlays` 옆에 렌더.
9. **옛 모달 제거** — `onboarding-dialog.tsx` 삭제. `design-overlays.tsx:36,39-40,65,97,194-202`의
   `"onboarding"`·`onOnboardingComplete`·`OnboardingDialog`·`completeDesignOnboarding` import 제거.
   `index.tsx:436` prop 전달 제거.
10. **테스트** —
    - `index.test.tsx:265,455-463` 온보딩 모달 전제를 코치마크로(첫 진입에 `role="dialog"` 말풍선과
      1스텝 제목, `건너뛰기` 후 키 `"1"`). `:507` "실사화" 버튼 단언은 위치가 바뀌어도 `name`으로 잡히므로
      유지 — 비활성 조건이 같은지만 확인.
    - `coach-mark.test.tsx` 신규 1파일: 타깃 두 개 중 하나가 숨겨졌을 때 보이는 스텝만 순회하고 마지막
      `완료`에서 `onClose`가 불리는지. jsdom은 `offsetParent`가 항상 `null`이므로 `checkVisibility`
      우선 판정으로 둔다.
    - `prompt-bar.test.tsx`에 "디자인 없으면 실사화 disabled, 있으면 enabled" 1건 추가. 점등 연출은
      테스트하지 않는다(CSS).
11. **린트·타입** — `pnpm lint && pnpm --filter store typecheck && pnpm --filter store test`.
    스포트라이트 그림자 색은 `bg.overlay` 변수 참조로 쓰고, `check-harness.mjs`에 걸리면
    `// harness-ignore(스포트라이트 딤, bg.overlay 토큰 참조)`.

## 검증

- 브라우저(Aside, `.claude/skills/aside-browser/SKILL.md`)에서 `localStorage.removeItem("design:coachmark:v1")`
  후 `/design` 새로고침:
  - 비로그인 PC 1280px: 갤러리 → 입력창 → 모티프 → 이력 → 미리보기 → 레일 순 6스텝. 각 스텝 스포트라이트
    위치 스크린샷.
  - 로그인 PC: 7스텝, 토큰 포함. 모바일 390px: 레일 대신 + 버튼이 잡히고 말풍선이 화면 안에 있는지.
  - `건너뛰기` 후 새로고침 시 다시 안 뜨고, 레일 "사용법"으로 다시 뜨는지. 진행 중 창 크기 변경 시
    스포트라이트가 따라오는지. 진행 중 딤 아래 버튼이 눌리지 않고 Esc 뒤엔 눌리는지.
  - 디자인 없는 상태에서 실사화 버튼이 회색 테두리 비활성인지 → 예시 하나로 시작 → 결과 도착 시
    그라디언트가 차오르며 점등 연출이 1회 재생되는지 → 수정 요청 1회 후 결과 도착 시 색만 돌아오고 연출이
    없는지. 화면에 그라디언트가 이 버튼 외에 없는지.
  - `grep -rn "bg-ai-gradient" apps packages`가 `action-button.tsx`·`theme.css` 외에 없는지(예외 누출 방지).
  - 실사화 클릭 → 기존 다이얼로그가 열리는지. 좌상단에 미리보기 토글, 우상단에 토큰 잔액만 있는지
    (PC·모바일 모두 한 줄, 모바일에서 토큰이 토글 아래로 내려가지 않는지). 입력창에 아이디어 버튼이 없는지.
- `pnpm lint && pnpm --filter store typecheck && pnpm --filter store test` 통과.
- 잔존 확인: `grep -rn "날염으로 선명한\|AI 디자인 시작하기\|아이디어 받기\|createDesignIdeas" apps/store/src`
  0건.

## 되돌리는 법 / 상향 신호

- 되돌리기: 이 플랜의 커밋을 revert하면 끝(서버·스키마 무관).
- 상향 신호: "그 버튼 어디 있냐"는 문의가 이어지거나 실사화 전환이 안 오르면, 스텝을 늘리기 전에
  계측 플랜(범위 밖 2항)을 먼저 쓴다.

## 기각한 대안

- **기존 모달의 내용만 기능 소개 슬라이드로 교체** — 화면 어디를 말하는지 그림으로 다시 그려야 하고
  실제 버튼과 어긋난다. 레이아웃이 자주 바뀌어 타깃 마킹 유지가 부담스러워지면 재론.
- **투어 라이브러리(driver.js, react-joyride)** — rect 측정 + fixed 말풍선 50줄로 충분. 스텝이 스크롤
  컨테이너 안으로 가거나 스텝 간 라우팅이 생기면 재론.
- **CSS anchor positioning + `popover="manual"`** — 타깃마다 `anchor-name`을 imperative하게 심어야 한다.
- **HelpBubbleTrigger를 각 버튼에 상주** — 순서 있는 첫 진입 안내가 목적. 특정 기능 하나만 반복 문의되면
  그 버튼에 한해 재론.
- **실사화를 레일 안에서 `brandSolid` 라벨 버튼으로 승격** — 이미 노출 버튼이 많아 소음이 는다.
- **실사화를 우상단 CTA로** — 토큰·토글과 경쟁하고 모바일 상단 폭이 모자란다. 모바일 편집기 관례
  (우상단 완료)라는 장점은 있으나, 입력창이 사용자의 손과 눈이 머무는 자리라 그쪽이 낫다고 결정.
- **레일을 ··· 메뉴 하나로 접기** — 재방문 사용자의 내 디자인·완성본 클릭이 한 단계 깊어진다. 사용자
  결정으로 기존 레일 형태 유지.
- **실사화 아이콘 카메라/사진/체크 배지** — 별(sparkles)이 AI 생성 뜻으로 가장 학습돼 있고 점등 연출과
  맞는다. 사용자 결정.
- **코치마크에 실사화 스텝 추가** — 점등 연출이 발견을 맡는다. 안내문 불필요(사용자 결정).
- **매 결과마다 점등 연출 재생** — 하루 수십 번 보는 전환. 첫 1회만.
- **실사화를 `brandSolid`로 두고 전송 버튼을 `neutralWeak`로 낮추기** — 솔리드 둘이 나란히 놓이는 문제를
  전송 쪽을 건드려 풀려 했으나, 사용자가 실사화에 그라디언트 예외를 주기로 결정해 전송은 그대로 둔다.
- **그라디언트를 클래스 임의 값(`bg-[linear-gradient(...)]`)으로** — `check-harness.mjs`가 막고, 정책상
  토큰 없는 그라디언트는 금지. 토큰+유틸리티+변형으로만.

## 실패 모드

두 가지다. (1) 타깃의 `data-coach`가 리팩터링 때 떨어져 나가도 에러 없이 스텝만 조용히 사라진다 —
방어선은 `index.test.tsx`에서 첫 진입 **스텝 수를 정확히 세는 단언**(비로그인 6). (2) 목업의 패널 모양·
문구를 스펙으로 오해해 실제 카드를 목업에 맞춰 고치는 것 — 이 문서에 없는 변경은 하지 않는다.
