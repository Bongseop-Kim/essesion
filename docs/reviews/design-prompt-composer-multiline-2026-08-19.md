# 디자인 페이지 입력창 멀티라인화 — 실행 기록 (2026-08-19)

`docs/plans/design-prompt-composer-multiline.md` 실행 완료. store 디자인 페이지 하단 컴포저를
한 줄 `<input>`에서 내용만큼 자라는 `<textarea>`로 바꿨다(GPT·Claude·Gemini 컴포저와 같은 동작).

## 바뀐 것

- `apps/store/src/features/design/ui/prompt-bar.tsx`
  - `<input>` → `<textarea rows={1}>`, `resize-none`. `aria-label`은 유지("무엇을 바꿀까요?").
  - 높이는 `value` 변경 시 `height:auto` → `scrollHeight` 2줄 effect. `maxHeight` 200px(약 8줄) 뒤
    내부 세로 스크롤(`overflow-y-auto`, `scrollbarWidth: thin`).
    `field-sizing: content`는 채택하지 않음 — Baseline Newly available 2026-06-16(Safari 26.2+/Firefox 152+)이라
    구형 iOS Safari에서 조용히 죽는다. 코드에 `ponytail:` 주석으로 교체 시점을 남겼다.
  - PC는 Enter 전송 / Shift+Enter 줄바꿈. **한글 조합 중(`isComposing`) Enter는 전송하지 않는다.**
    모바일(`matchMedia("(pointer: coarse)")`)은 Enter를 가로채지 않고 전송은 버튼으로 — 가상 키보드에 Shift가 없다.
  - 여러 줄 대응 레이아웃: `alignItems` center → flex-end(버튼 하단 고정), `borderRadius` full → `r6`,
    `h-12` 제거 → `py="x1"` + `minHeight={48}`(빈 상태에서 기존과 같은 48px).
  - `maxLength={4000}` — 서버 `MAX_DESIGN_PROMPT_LENGTH`(`apps/api/src/api/domains/design/router.py:57`)와 동일.
    멀티라인이 붙여넣기 경로를 열기 때문에 프론트에서 먼저 막는다.
- `apps/store/src/pages/design/index.tsx` — placeholder 단축("무엇을 바꿀까요?" / "원하는 넥타이를 알려주세요").
  `rows={1}` textarea는 긴 문구를 한 줄 높이에서 잘라 보인다.
- `apps/store/src/features/design/ui/prompt-bar.test.tsx` 신규 — Enter/Shift+Enter/IME 조합/모바일 4케이스.
- `apps/store/src/pages/design/index.test.tsx` — `select` 스파이와 캐스트를 `HTMLTextAreaElement`로.

## 검증 (2026-08-19)

- `pnpm --filter store test` 59파일·226테스트 통과, `pnpm lint`(check-harness OK)·`pnpm typecheck`·`pnpm --filter store build` 통과.
- 브라우저 실측(Aside, store :3000 `/design`, 1440×900): 빈 상태 pill 48px → 2줄 60px → 20줄에서 210px에
  멈추고 textarea 내부 스크롤(`clientHeight 200 / scrollHeight 392`). 캔버스가 그만큼 줄어 겹침 없음.
  Shift+Enter가 줄바꿈으로 들어가고 높이가 따라 자람. 콘솔 오류 없음.
- 미검증으로 남긴 것: **iOS Safari 실기기에서 가상 키보드가 올라올 때 컴포저 가림 여부**. 가려지면
  focus 핸들러에 `scrollIntoView({ block: "nearest" })` 한 줄만 추가한다(뷰포트 meta의
  `interactive-widget=resizes-content`는 WebKit 미구현이라 기각 — [WebKit #259770](https://bugs.webkit.org/show_bug.cgi?id=259770)).

## 남은 판단거리

- placeholder에서 힌트("색, 줄무늬, 배치, 크기")를 뺐다. 아이디어 버튼이 그 역할을 하지만, 첫 사용자가
  무엇을 쓸지 몰라 이탈하는 신호가 보이면 md~ 전용 긴 문구를 되살린다.
- api 스펙 변경 없음(프론트 표현만). Alembic·codegen 무관.
