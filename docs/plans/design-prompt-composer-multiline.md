# 디자인 페이지 입력창 멀티라인화 (ChatGPT 컴포저 UX)

store 디자인 페이지 하단 입력창(`apps/store/src/features/design/ui/prompt-bar.tsx`)을
한 줄 `<input>`에서 **한 줄로 시작해 입력에 따라 늘어나는 `<textarea>`**로 바꾼다.
선행 조건 없이 바로 실행 가능하다.

## 왜 필요한가

- 현재는 `prompt-bar.tsx:79`의 `<input>` + `prompt-bar.tsx:59`의 고정 `h-12`라서 프롬프트가
  길어지면 보이는 영역이 한 줄로 고정되고, 사용자는 자기가 쓴 문장의 앞부분을 볼 수 없다.
  디자인 수정 프롬프트("색은 남색, 줄무늬는 좁게, 벌 모티프는 작게")는 실제로 두 줄을 넘는다.
- ChatGPT·Claude·Gemini 컴포저는 모두 **1줄 시작 → 내용에 따라 성장 → 상한에서 내부 세로 스크롤**
  패턴이고, 사용자가 이 동작을 기대한다(2026-08-19 사용자 관찰 · 첨부된 chatgpt.com 컴포저 DOM).
- 실패 모드: **한글 IME**. `Enter`로 전송을 붙이면서 `isComposing`을 보지 않으면 조합 중 Enter가
  전송으로 새어 "가나" 같은 미완성 입력이 그대로 API로 간다. 이 플랜의 주된 실패 모드다.

## 범위 밖 (non-goals)

- 파일 첨부·음성 등 컴포저 기능 추가 없음. 지금 있는 3버튼(도구·아이디어·전송) 구성 유지.
- 다른 화면의 입력(모티프 검색, 아이디어 모달, 주문 폼, admin)은 건드리지 않는다.
  공용 `TextAreaField`도 수정하지 않는다 — 이 컴포저는 label 없는 pill이라 shared 컨트롤과
  형태가 다르다(shared 규칙 0: 2개 앱에서 쓰일 때만 shared로).
- api 스펙·`docs/api-spec/` 변경 없음(프론트 표현만 바뀐다).

## 절차

순서대로 실행한다. 1~4가 본체(한 커밋 분량), 5~7은 멀티라인화가 열어놓는 구멍 막기, 8~9는 테스트다.

1. **`<input>` → `<textarea>` 교체** — `prompt-bar.tsx:79-87`. `ref` 타입을
   `HTMLTextAreaElement`(`prompt-bar.tsx:40`)로, `rows={1}`, `resize-none` 추가.
   `aria-label`·`placeholder`·`value`·`disabled`·`onChange`·기존 className은 그대로 유지한다
   (테스트가 `findByLabelText("무엇을 바꿀까요?")`로 잡는다).
2. **자동 높이 성장** — 값이 바뀔 때 `el.style.height = "auto"` → `el.style.height = scrollHeight + "px"`
   를 실행하는 `useEffect`(의존성 `[value]`)를 `prompt-bar.tsx:42`의 기존 effect 옆에 둔다.
   컨테이너(`prompt-bar.tsx:48-63`)에서 고정 `h-12`를 제거하고 `minHeight={48}`로 바꾸며,
   textarea에 `maxHeight={200}`(약 8줄) + `overflowY="auto"`를 준다 — 상한 뒤엔 내부 세로 스크롤
   (shared 규칙 10: 세로 스크롤은 허용, 가로만 금지). 높이·최대높이는 구조값이라 숫자 허용(규칙 2).
   근거: `field-sizing: content` 한 줄이면 JS가 필요 없지만 Baseline Newly available이 2026-06-16이라
   (Safari 26.2+ / Firefox 152+) 구형 iOS Safari에서 성장이 조용히 죽는다. 분기 두 개를 두는 대신
   전 브라우저에서 같게 동작하는 JS 경로 하나만 둔다. `ponytail:` 주석으로 상한과 업그레이드 경로
   (지원 하한이 올라가면 effect를 지우고 `field-sizing: content`로 대체)를 남긴다.
3. **키 처리** — textarea에 `onKeyDown`을 붙인다. `Enter` + `!event.shiftKey` +
   `!event.nativeEvent.isComposing` + 세로 포인터가 정밀할 때만 `preventDefault()` + `onSubmit()`.
   모바일(`matchMedia("(pointer: coarse)")` 참)에서는 Enter를 가로채지 않는다 — 가상 키보드에는
   Shift가 없어 줄바꿈 수단이 사라진다(ChatGPT 모바일도 Enter=줄바꿈, 전송은 버튼).
   `<Flex as="form">`의 `onSubmit`(`prompt-bar.tsx:60-63`)은 전송 버튼용으로 그대로 둔다.
4. **버튼 정렬** — 컨테이너 `alignItems`를 `center` → `flex-end`로, `borderRadius="full"` →
   `r6`(24px, 48px 높이에서 `full`과 같은 모양)로 바꾼다. 여러 줄일 때 `full`은 캡슐로 늘어나고
   버튼이 세로 중앙에 떠서 ChatGPT/Claude와 다르게 보인다.
5. **길이 상한을 서버와 맞춘다** — textarea에 `maxLength={4000}`. 서버는
   `apps/api/src/api/domains/design/router.py:57`의 `MAX_DESIGN_PROMPT_LENGTH = 4_000`으로 검증하므로
   지금은 4001자를 붙여넣으면 422로 떨어진다(한 줄 input에서는 실질적으로 안 일어났지만 멀티라인은
   붙여넣기 경로가 열린다). 상수는 api-client에 노출되지 않으니 프론트에 숫자를 두고 근거 주석을 단다.
6. **placeholder를 모바일에서 짧게** — `apps/store/src/pages/design/index.tsx:398-411`의 placeholder는
   `<input>`에서는 한 줄로 잘리지 않지만 `rows={1}` textarea에서는 좁은 폭에서 두 번째 줄이 잘려 보인다.
   모바일 문구를 "무엇을 바꿀까요?" / "원하는 넥타이를 알려주세요" 수준으로 줄이고 긴 문구는 md~에서만
   쓴다(값은 페이지가 소유 — PromptBar는 문구를 모른다).
7. **높이 변화에 트랜지션을 넣지 않는다** — `prompt-bar.tsx:59`의 `transition-colors`는 그대로 두고
   `transition-all`로 넓히지 않는다. 높이가 캐럿보다 늦게 따라오면 입력이 밀리는 느낌이 난다
   (ChatGPT·Claude 모두 높이는 즉시, 색만 트랜지션). 스크롤바는 상황별 판단이므로
   (`packages/shared/docs/foundation/scroll.md:11`) 컴포저는 얇게 표시해 상한에 닿았음을 알린다.
8. **테스트 수정** — `apps/store/src/pages/design/index.test.tsx:334`의
   `vi.spyOn(HTMLInputElement.prototype, "select")`를 `HTMLTextAreaElement.prototype`으로,
   같은 파일 `:343`의 캐스트를 `HTMLTextAreaElement`로, `:209` `disabled()` 헬퍼의 유니온에
   `HTMLTextAreaElement`를 추가한다. 이 세 곳이 유일한 타입 결합점이다.
9. **회귀 테스트 1개 추가** — `apps/store/src/features/design/ui/prompt-bar.test.tsx`.
   Shift+Enter와 IME 조합 중 Enter(`fireEvent.keyDown(el, { key: "Enter", isComposing: true })`)가
   `onSubmit`을 호출하지 않고, 맨 Enter는 호출함을 확인한다. 파일 하나·케이스 3개로 끝낸다.

## 검증

- `pnpm --filter store test prompt-bar` — 새 테스트 통과.
- `pnpm --filter store test design` — 기존 디자인 페이지 스위트(입력창 잠금·거절 시 전체 선택) 통과.
- `pnpm lint && pnpm typecheck` — harness 검사(임의 값·raw div)와 ref 타입 변경 확인.
- 브라우저 실측(aside-browser 스킬, store :3000 `/design`):
  ① 진입 시 입력창 높이가 48px 한 줄, ② 긴 문장을 붙여넣으면 캔버스가 줄고 입력창이 자라며,
  ③ 8줄 넘기면 입력창 안에서 세로 스크롤이 생기고 높이가 더 안 자라며, ④ 한글을 조합하다 Enter를
  눌러도 전송되지 않고, ⑤ 전송 후 값이 비면 다시 한 줄로 돌아온다.
- iOS Safari 실측(가능하면 실기기, 아니면 시뮬레이터) — 키보드가 올라올 때 입력창이 가려지지 않는지.
  가려지면 focus 핸들러에 `scrollIntoView({ block: "nearest" })` 한 줄만 추가한다.
- 스낵바가 자란 입력창을 가리지 않는지 확인 — `design-canvas.tsx:144`의 `SnackbarAvoidOverlap`은
  ResizeObserver로 높이를 재등록하므로 별도 작업 없이 맞아야 한다(`packages/shared/src/components/snackbar.tsx:73`).

## 되돌리는 법 / 상향 신호

되돌리기는 `prompt-bar.tsx` + `pages/design/index.tsx`(placeholder) + `index.test.tsx` 세 파일 revert로 끝난다.
되돌려야 하는 신호: 모바일에서 입력창이 자라며 캔버스 넥타이가 잘려 보이거나, 자동 높이 계산이
스크롤 점프를 만드는 경우. 후자는 `maxHeight`를 낮추는 쪽을 먼저 시도한다.

## 기각한 대안

- **`field-sizing: content` 단독** — 코드는 한 줄로 가장 짧지만 2026-08 기준 구형 iOS Safari에서
  성장이 사라진다. 지원 하한이 Safari 26.2+/Firefox 152+로 올라가면 재론한다(항목 2의 업그레이드 경로).
- **shared `TextAreaField` 재사용**(`packages/shared/src/components/text-field.tsx:177`) — Field 프레임·
  라벨 배선이 붙어 있어 pill 컴포저 형태를 못 낸다. 컴포저가 admin에도 생기면 재론한다.
- **CSS grid 미러 div 트릭** — 브라우저 호환은 좋지만 값을 두 번 렌더해야 해서 JS 두 줄보다 복잡하다.
- **`interactive-widget=resizes-content`를 viewport meta에 추가**(`apps/store/index.html:5`) — iOS Safari가
  아직 미구현이라 정작 문제인 브라우저에서 효과가 없고, 변경 범위는 store 전 페이지다
  ([WebKit #259770](https://bugs.webkit.org/show_bug.cgi?id=259770)). Safari가 구현하면 재론한다.
- **길이 초과 안내 UI(카운터·경고)** — `maxLength`가 입력을 막아주므로 문구까지는 불필요.
  4000자를 실제로 치는 사용자가 관측되면 재론한다.
- **컴포저 확장(첨부·모델 선택 등) 동시 진행** — 이 플랜은 높이·키 처리만 다룬다. 기능 추가는 별 플랜.

## 출처

- `field-sizing` Baseline Newly available 2026-06-16, Chrome 123+/Edge 123+/Safari 26.2+/Firefox 152+:
  [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/field-sizing),
  [web-features explorer](https://web-platform-dx.github.io/web-features-explorer/features/field-sizing/),
  [web.dev 2026-06](https://web.dev/blog/web-platform-06-2026)
