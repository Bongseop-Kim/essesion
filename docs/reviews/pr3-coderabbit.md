# PR #3 CodeRabbit 리뷰 대응 플랜

- 대상: [PR #3 Feat/front](https://github.com/Bongseop-Kim/essesion/pull/3) (`feat/front` → `main`) — CHECKLIST **5단계(프론트)** 진행 중.
- CodeRabbit findings: **inline 20건**(Critical/Major 우선) + Minor 5 + Duplicate 2 + Nitpick 22
- 실제 코드로 검증 완료. verdict·수정 방향은 검증 결과 기준이며, 5단계 = 디자인 시스템 구축 단계이므로 토큰/하네스 결정은 **지금 이 문서에서 확정**한다(미루지 않음).

## 핵심 관찰

CR findings의 **대부분은 하네스 규칙 1(raw 레이아웃)·규칙 5(raw 타이포) 위반**이다. 이걸 이해하려면 이 repo에서 "규칙"이 두 층으로 나뉘어 있다는 걸 먼저 알아야 한다.

### "규칙"은 두 가지 — 서술 규칙 vs 기계 검사

- **(a) `packages/shared/AGENTS.md`의 규칙 0~9** — *사람이 지켜야 할* 디자인 시스템 서술 규칙.
  - 규칙 1: 레이아웃은 프리미티브(`Box`/`Flex`/`HStack`/`VStack`/`Grid`/`Float`)로만. 레이아웃 목적의 raw `<div>` + Tailwind 레이아웃 클래스(`flex`·`gap-2`·`p-4`) 금지.
  - 규칙 5: 타이포는 `<Text textStyle>`만. raw `<h2 className="text-t*">` 금지.
  - 규칙 0 ③: 프리미티브+토큰으로 표현이 안 되면 임의값으로 우회하지 말고 **멈추고 토큰/컴포넌트 추가를 제안**.
  - 규칙 6: ActionButton 등 인터랙티브 컴포넌트는 예외 — cn() variant 레코드 안에서 `inline-flex`·`text-t*`를 정당하게 쓴다.
- **(b) `scripts/check-harness.mjs`의 `RULES` 배열** — (a) 중 *일부만* 정규식으로 기계 검사하는 코드. `pnpm lint`에 연결돼 위반 시 `exit 1`. 실제로 잡는 6개:
  `arbitrary-value`(`w-[13px]`) · `raw-hex`(`#fff`) · `default-palette`(`bg-red-500`) · `dead-utility`(`text-sm`) · `palette-escape`(`palette.`) · `inline-font-size`(`fontSize:`).

**핵심: (a)의 규칙 1·규칙 5는 (b)에 구현이 없다.** 그래서 raw `<div className="flex">`·`<h2 className="text-t7">`가 `pnpm lint`를 통과하는데도 CR은 위반이라고 잡는다. CR findings의 상당수가 정확히 이 "기계가 안 잡는 서술 규칙" 영역이다.

### 이 findings는 고치는 게 맞다 (리뷰어 취향 아님)

repo가 **스스로** AGENTS.md 규칙 1에 "raw `<div>` 금지, 프리미티브만"을 못 박았다. CR의 raw-레이아웃 지적은 남의 취향이 아니라 **이 프로젝트가 자기 규칙을 어긴 걸 짚은 것** → 아래 B에서 수정한다. 치환은 기능·렌더 결과 동일, 표현만 프리미티브로 바꾸는 것뿐이다:

```diff
  # 레이아웃 (규칙 1)
- <div className="px-x5 pt-x5 flex flex-col gap-x1_5">
+ <Flex direction="column" gap="x1_5" className="px-x5 pt-x5">

  # 타이포 (규칙 5)
- <h2 className="text-t7 font-bold">{title}</h2>
+ <Text as="h2" textStyle="title3" className="font-bold">{title}</Text>
```

프리미티브 교체는 **실행 가능** 확인: `Box`/`Flex`가 이벤트·ref·나머지 props를 그대로 forward(`box.tsx`가 `domProps` 스프레드). `<Flex as="button">`로 이벤트/`type`/`aria-label`까지 전달돼 삭제 버튼 같은 raw `<button>`도 교체 가능.

### 린터(check-harness)는 이번 PR에서 확장하지 않는다

"린터 확장" = (b)의 `RULES`에 규칙 1/5용 정규식을 새로 추가하는 것. 예: `{ name: "raw-layout", regex: /className="[^"]*\b(flex|grid|gap-|p-\d|m-\d)\b/ }`.

**안 하기로 한 이유 — 정규식은 문맥을 몰라 오탐이 크다:**
- ActionButton은 규칙 6 예외로 cn() 안에서 `inline-flex items-center gap-2`를 **정당하게** 쓴다 → 위 정규식이 위반으로 오탐.
- `text-t*`도 variant 레코드 안에선 정당함 → 오탐.

"어디에 쓰였나"를 정규식이 구분 못 하니 오탐이 쏟아지고, PR 블로커도 아니다. → 규칙 1/5 강제는 **리뷰-타임(CR)에 맡기고** 아래 수정은 수동 처리. (린터 문맥 인식 강화는 별도 과제로만 기록, 이번 스코프 아님.)

---

## A. 실제 결함 — 우선 수정 (검증 완료, 작고 위험 낮음)

한 커밋으로 묶는다. PR 머지 blocker.

| # | 위치 | 문제 | 수정 |
|---|------|------|------|
| A1 | `internal/use-dialog.ts:47-78` | `open` 시 `body.paddingRight` 세팅(L60), 복원은 native `close` 이벤트(L92)에서만. **open 상태로 언마운트되면 close 이벤트가 없어 padding이 body에 잔존** | 이전 값 저장 후 effect cleanup에서 복원 |
| A2 | `scroll-fog.tsx:64-79` | `ref`가 `ComponentPropsWithRef<"div">`에 있으나 구조분해 누락 → `{...props}`(L78)가 내부 ref 콜백(L66)을 덮어씀. **소비자가 ref를 넘기면 `innerRef`가 null → fog 마스킹 사망** | 외부 ref + 내부 ref 병합 콜백 |
| A3 | `pull-to-refresh.tsx:41-57` | `handleTouchEnd`가 async인데 `onTouchEnd`가 반환 promise 미await. `onRefresh()` reject 시 **unhandled rejection** | 기존 try/finally에 `catch` 추가 |
| A4 | `avatar.tsx:31` | `failed` state가 `src` 변경 시 미리셋 → 이전 실패가 새 유효 `src`에서도 폴백만 표시 | `useEffect(() => setFailed(false), [src])` |
| A5 | `field-button.tsx:12` | 포커스 링이 `outline-stroke-brand` — 규칙 6은 `focus-visible:outline-stroke-focus-ring` 강제 | 토큰 1개 교체 (`--color-stroke-focus-ring` 존재 확인) |
| A6 | `scripts/check-harness.mjs:23-26` | allow 정규식의 `min-`/`max-`가 넓어 `min-w-[100px]` 같은 임의값 유틸까지 통과(false negative) | `min-\[`/`max-\[`로 좁혀 미디어쿼리 변형만 허용 |
| A7 | `divider.tsx:22-26` | `as="hr"`+`vertical`에서 `aria-orientation` 누락 → 스크린리더가 가로로 인식 | vertical이면 `as` 무관하게 `aria-orientation="vertical"` |
| A8 | `menu.tsx:295-307` | `MenuGroup`의 `role="group"`에 접근 가능한 이름 없음 | `label`이 string이면 `aria-label` 연결 |

## B. raw 레이아웃/타이포 → 프리미티브 (기계적 일괄, 동작 변화 없음)

규칙 1/5 위반. 위험 낮고 건수 많음. 파일 그룹별 커밋 권장.

**레이아웃** (`<div className="flex/gap/…">`·raw `<button>` → `Box`/`Flex`/`HStack`/`VStack`, 필요 시 `as`):
- `alert-dialog.tsx` (제목/설명/액션 래퍼)
- `bottom-sheet.tsx` (헤더/바디/푸터)
- `internal/sheet-dialog.tsx:96-105` (셸/핸들 래퍼 — `{...handleProps}`는 Flex가 forward)
- `page-banner.tsx:65` (루트/액션 레이아웃)
- `callout.tsx:69-76, 96-103` (Duplicate)
- `radio-group.tsx:59` (radiogroup 컨테이너/label)
- `select-box.tsx:125` (raw `<label>`+flex)
- `side-panel.tsx:101`
- `swipeable-menu-sheet.tsx:79, 144` (콘텐츠/헤더, Group→VStack)
- `text-field.tsx:20` (`FieldFrame` div → `Flex`)
- `image-frame.tsx:63-76` (`ImageFallback` → `Flex`)
- `pull-to-refresh.tsx:64-95` (컨테이너/오버레이/스크롤 → `Box`/`Flex`, 동적 transform/opacity만 inline 유지 — A3와 같은 파일)
- `attachment-display-field.tsx:70-77` — **삭제 버튼 `<button className="flex …">` → `<Flex as="button">`**. 새 `IconButton` 불필요(ActionButton에 `iconOnly`가 있으나 20px 코너 뱃지엔 과대). `Float`의 `style={{transform: translate(30%,-30%)}}`(L68)는 %기반 장식 micro-nudge로 토큰화 불가·린터 미검출 → **그대로 유지**(기존 주석 보존).

**타이포** (`<h2>`/`<span className="text-t*">` → `<Text as textStyle>`):
- `page-banner.tsx:64, 71-74`
- `callout.tsx:86-90` (Duplicate)
- `radio-group.tsx:79`
- `side-panel.tsx:93`
- `swipeable-menu-sheet.tsx` (제목/설명/버튼 텍스트)

## C. 토큰 추가 (결정 완료)

| # | 위치 | 조치 |
|---|------|------|
| C1 | `skeleton.tsx:39` `via-white/60` | `theme.css`에 shimmer 하이라이트 **시맨틱 토큰 추가**(이미 `--animate-shimmer` 자리 옆, "gradient.md 로컬 허용" 주석 구역) → `via-<token>` 사용 + `docs/foundation/design-token-reference.md` 갱신. `--color-white` 직접 참조 제거 |

## D. Nitpick (22건) — 여유 시 반영, 그룹별 커밋

**D-1. 모션 토큰** (`duration-100` → `--duration-fast`):
- `chip.tsx:60-67` · `floating-action-button.tsx:36-46` · `toggle-button.tsx:59-66`

**D-2. raw 요소 → 프리미티브/Text** (B와 동성격, Trivial):
- `field-button.tsx:74-84` (raw `<span>`+layout) · `modal.tsx:78-100` (raw div) · `modal.tsx:81-84` (`<h2>`→Text) · `list.tsx:51-91` · `checkbox.tsx:64-117` · `segmented-control.tsx:59-68`

**D-3. raw 시각 숫자 → 토큰**:
- `segmented-control.tsx:74-75` (`itemLabelClass` raw 값) · `apps/store preview content.tsx:116-122` (`height=380`/`borderWidth=1`) · `content.tsx:104` (`Icon size=48`)

**D-4. Preview 파일 아이콘/폭**:
- `buttons.tsx:93-100` (`PlusIcon` → `Icon` 래퍼) · `feedback.tsx:9-15` (heroicons `Icon` 래퍼 없이 직접 사용) · `sheets.tsx:34-39` (`className="w-full"` → `Box width="full"`, ActionButton엔 width prop 없음)

**D-5. 접근성/유연화**:
- `menu.tsx:226-243` MenuContent에 `aria-labelledby`(트리거 참조, 양방향 관계)
- `side-panel.tsx:63-67` title/aria-label 둘 다 없을 때 이름 누락 — 컴파일 타임 강제 고려
- `accordion.tsx:138-174` 트리거 heading 레벨(`h3`) 고정 → prop으로 유연화
- `internal/glyphs.tsx:8-50` `aria-hidden` prop 오버라이드 허용

**D-6. 성능/정리/잠재이슈**:
- `scroll-fog.tsx:31-40` 스크롤마다 setState 리렌더 → 값 변화 시에만 (A2와 같은 파일, 함께)
- `page-banner.tsx:6` `Tone` 유니온 타입 `callout.tsx`와 중복 → 공통 추출
- `pull-to-refresh.tsx:28-39` 터치 제스처 vs 브라우저 기본 스크롤 충돌 가능성 (A3/B와 같은 파일, 함께 검토)

---

## 실행 순서

1. **A** (실제 버그·a11y 8건) — 단독 커밋. PR 머지 blocker 해소.
2. **C1** (skeleton 토큰) — theme.css + reference 갱신, 드리프트 가드 테스트 확인.
3. **B** (프리미티브 일괄) — 파일 그룹별. `attachment` 삭제버튼·`pull-to-refresh` 레이아웃 포함.
4. **D** (nitpick) — 그룹(D-1~D-6)별 선택 반영. 파일 겹치는 것(scroll-fog, pull-to-refresh)은 상위 작업과 함께.

## 검증

- `pnpm lint` (check-harness + Biome), `pnpm turbo build typecheck test`
- 버그별 동작 확인: A1 모달 언마운트 후 body padding / A2 외부 ref 주입 시 fog / A3 onRefresh reject / A4 src 교체 시 재로드
- C1: 드리프트 가드 vitest + dist grep, 라이트 모드 shimmer 육안
- 기존 스타일/스낵바 테스트 유지
