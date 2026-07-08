# PR #3 CodeRabbit 대응 실행 계획

분석·verdict: [reviews/pr3-coderabbit.md](../reviews/pr3-coderabbit.md) · 대상 PR: [#3 Feat/front](https://github.com/Bongseop-Kim/essesion/pull/3) · 단계: CHECKLIST 5단계(프론트)

## 원칙

- **커밋 단위 = 아래 스텝 1개.** 각 스텝은 독립적으로 리버트 가능해야 한다.
- 매 커밋 후 `pnpm lint`(check-harness + Biome) + `pnpm turbo build typecheck test` 통과. 깨지면 그 커밋이 잘못된 것.
- findings의 "무엇을/왜"는 리뷰 문서에 있다 — 이 문서는 "어떻게/순서/검증"만. finding 번호(A1·B·D-1…)는 리뷰 문서와 1:1 대응.
- 순서는 리스크·독립성 기준: **실제 결함(1~3) → 토큰(4) → 프리미티브 일괄(5~8) → nitpick(9~14)**. 1~3만 머지해도 PR blocker는 해소된다.
- 수정 전 각 파일을 읽고 아래 "가정"을 실제 코드로 확인 후 진행(가정이 틀리면 스텝 재조정).

## 가정 (진행 전 확인)

- **모달 중첩 없음**(AGENTS.md "모달 위 모달 금지") → A1의 body padding 복원은 "이전 값으로 되돌리기"로 안전.
- `Text`는 `color`·`align` prop 지원(`attachment-display-field.tsx`가 이미 사용 중 — 근거 있음). `VStack`/`HStack` 존재(색인 표). 편집 시 재확인.
- C1 토큰 추가는 드리프트 가드 vitest의 기대 토큰 집합을 함께 갱신해야 통과.

---

## 실행 순서 (커밋 단위)

### 1. 컴포넌트 실제 결함 (A1~A5)

한 커밋. 전부 작고 독립적이며 동작 결함.

- **A1 `internal/use-dialog.ts`** — effect에서 `body.paddingRight` 적용 직전 이전 값을 지역 변수로 캡처, effect **cleanup에서 복원**(현재는 native `close` 이벤트에서만 복원 → open 상태 언마운트 시 누수). close 이벤트 경로의 복원은 유지(이중 복원 무해).
- **A2 `scroll-fog.tsx`** — `props`에서 `ref`를 구조분해로 꺼내고, ref 콜백에서 `innerRef.current = node`와 외부 ref(콜백/객체 양형)를 **둘 다** 세팅. `{...props}`에 ref가 남아 내부 콜백을 덮는 현상 제거.
- **A3 `pull-to-refresh.tsx`** — `handleTouchEnd`의 `await onRefresh()`를 `try/catch/finally`로 감싸 finally 상태정리는 보장하고 rejection이 unhandled로 새지 않게. 에러는 재던지지 않음(onRefresh 소유자가 처리) — `// ponytail:` 주석으로 의도 명시.
- **A4 `avatar.tsx`** — `useEffect(() => setFailed(false), [src])` 추가. `useEffect` import 추가.
- **A5 `field-button.tsx:12`** — `focus-visible:outline-stroke-brand` → `focus-visible:outline-stroke-focus-ring` (1토큰).

완료 기준: typecheck·test 통과. 수동 확인 4종 — 모달 열고 언마운트 후 `document.body.style.paddingRight===""` / ScrollFog에 외부 ref 주입 시 마스킹 동작 / `onRefresh` reject 시 콘솔에 unhandled rejection 없음 / `src`를 실패→유효로 교체 시 이미지 재로드.

### 2. 린터 정확도 (A6)

별도 커밋 — 좁힌 뒤 새로 드러나는 위반이 있을 수 있어 분리.

- **A6 `scripts/check-harness.mjs:24`** — allow 정규식의 `min-|max-` → `min-\[|max-\[`.
- 좁힌 직후 `pnpm lint` 실행 → 새로 잡히는 `min-w-[…]`류가 있으면 해당 위반도 이 커밋에서 토큰/프리미티브로 해소(없으면 그대로).

완료 기준: `pnpm lint` OK. `min-[768px]:` 같은 미디어쿼리 변형은 여전히 통과, `min-w-[100px]`는 이제 차단됨을 스팟 확인.

### 3. 접근성 (A7~A8)

한 커밋.

- **A7 `divider.tsx:22-26`** — `vertical`이면 `as` 무관하게 `aria-orientation="vertical"` 부여(현재 `as!=="hr"`일 때만).
- **A8 `menu.tsx:295-307`** — `MenuGroup`에서 `label`이 string이면 `aria-label={label}` 부여.

완료 기준: typecheck·test 통과. `as="hr" orientation="vertical"` 렌더 결과에 `aria-orientation="vertical"` 존재 / `MenuGroup` `role="group"`에 접근명 존재(DOM 스팟 확인).

### 4. Skeleton shimmer 토큰 (C1)

한 커밋 — theme.css + 문서 + 소비처 + 테스트 동시.

- `theme.css`의 shimmer 주석 구역에 하이라이트용 **시맨틱 토큰** 추가(예: `--color-bg-shimmer-highlight`, 값 = 현행 white/60 상당). `@theme static` 규칙(규칙 9) 준수 위치에.
- `skeleton.tsx:39` `via-white/60` → `via-<신규토큰>` (`--color-white` 직접 참조 제거).
- `docs/foundation/design-token-reference.md`에 토큰 행 추가.
- 드리프트 가드 vitest 기대 토큰 집합 갱신.

완료 기준: 드리프트 가드 vitest 통과, 빌드 후 dist grep 통과, 라이트 모드 skeleton shimmer 육안 무변화.

### 5. 프리미티브 교체 — 오버레이 (B)

한 커밋(오버레이 묶음). raw `<div className="flex…">`·`<h2 className="text-t*">` → `Flex`/`VStack`/`Text as textStyle`. 기능 동일.

- `alert-dialog.tsx` · `bottom-sheet.tsx` · `internal/sheet-dialog.tsx:96-105`(`{...handleProps}`는 Flex forward) · `side-panel.tsx:93,101` · `swipeable-menu-sheet.tsx:79,144`(Group→VStack)

완료 기준: lint·typecheck·test 통과. 각 오버레이 프리뷰 렌더가 교체 전후 동일(스냅샷/육안). 핸들 드래그(sheet-dialog) 동작 유지.

### 6. 프리미티브 교체 — 폼 (B)

한 커밋.

- `radio-group.tsx:59,79` · `select-box.tsx:125`(raw `<label>`) · `text-field.tsx:20`(`FieldFrame`→`Flex`) · `attachment-display-field.tsx:70-77`(삭제 `<button>`→`<Flex as="button">`; `transform` micro-nudge·기존 주석 유지, **새 IconButton 만들지 않음**)

완료 기준: lint·typecheck·test 통과. 폼 프리뷰 상호작용(포커스·클릭·삭제) 유지, `<label>` 연결(htmlFor/id) 불변.

### 7. 프리미티브 교체 — 피드백/디스플레이 (B)

한 커밋.

- `page-banner.tsx:64,65,71-74` · `callout.tsx:69-76,86-90,96-103`(Duplicate) · `image-frame.tsx:63-76`(`ImageFallback`→`Flex`)

완료 기준: lint·typecheck·test 통과, 프리뷰 육안 동일.

### 8. 프리미티브 교체 — pull-to-refresh 레이아웃 (B)

한 커밋(A3와 같은 파일이라 3번 이후 별도).

- `pull-to-refresh.tsx:64-95` 컨테이너/오버레이/스크롤 래퍼 → `Box`/`Flex`, **동적 `transform`/`opacity`만 inline 유지**. D-6의 터치 충돌 검토(`28-39`)를 이 커밋에서 함께 판단.

완료 기준: lint·typecheck·test 통과. 터치 당김→새로고침 동작(모바일 뷰) 유지.

---

## Nitpick (D) — 여유 시, 그룹별 커밋

각 그룹 = 1커밋. 기능 영향 없음. 미적용해도 무방(선택).

### 9. 모션 토큰 (D-1)
`chip.tsx` · `floating-action-button.tsx` · `toggle-button.tsx`의 `duration-100` → `--duration-fast` 기반 사용. 완료: 트랜지션 육안 무변화(둘 다 100ms).

### 10. raw 요소 → 프리미티브 (D-2)
`field-button.tsx:74-84` · `modal.tsx:78-100,81-84` · `list.tsx:51-91` · `checkbox.tsx:64-117` · `segmented-control.tsx:59-68`. 5번과 동일 성격. 완료: 프리뷰 육안 동일.

### 11. raw 시각 숫자 → 토큰 (D-3)
`segmented-control.tsx:74-75` · preview `content.tsx:104,116-122`. 완료: lint OK, 육안 동일.

### 12. Preview 아이콘/폭 (D-4)
`buttons.tsx:93-100`·`feedback.tsx:9-15`(heroicons→`Icon` 래퍼) · `sheets.tsx:34-39`(`w-full`→`Box width="full"`). 완료: 프리뷰 렌더 동일.

### 13. 접근성/유연화 (D-5)
`menu.tsx:226-243`(MenuContent `aria-labelledby`) · `side-panel.tsx:63-67`(이름 누락 방지) · `accordion.tsx:138-174`(heading 레벨 prop화) · `internal/glyphs.tsx:8-50`(`aria-hidden` override). 완료: DOM 스팟 확인, 기존 동작 불변.

### 14. 성능/정리 (D-6)
`scroll-fog.tsx:31-40`(값 변화 시에만 setState — A2와 같은 파일, 2번과 함께 처리 가능) · `page-banner.tsx:6`(`Tone` 타입 `callout.tsx`와 공통 추출). 완료: 리렌더 감소 확인(선택), typecheck 통과.

---

## 마무리

- CR 코멘트별 resolve/reply(적용·스킵 사유). 스킵 항목: 없음(전부 반영) 또는 D 일부 보류 시 사유 명시.
- PR 제목을 CR title-check 지적대로 구체화(예: "공유 디자인 시스템 및 store/admin UI 컴포넌트 추가").
- 최종 `pnpm lint` + `pnpm turbo build typecheck test` 그린 확인 후 리뷰 재요청.
