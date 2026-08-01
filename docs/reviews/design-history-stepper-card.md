# 편집 이력을 좌측 카드 스테퍼로 (store /design)

실행일: 2026-08-01

상태: 구현·검증 완료. `docs/plans/design-history-stepper-card.md` 전체 범위. API·스키마·워커 변경 없음.

하단 가로 이력 트랙을 없애고 좌측 컬럼(모티프 카드 아래)에 카드 스테퍼를 뒀다. 캔버스 하단에는
입력창만 남는다. 같은 1440×900에서 **넥타이 496 → 585px**(플랜 목표 560px 상회).

## 변경

**삭제** — `features/design/ui/history-track.tsx`

**신규**

| 파일 | 내용 |
|---|---|
| `ui/history-card.tsx` | 좌측 카드 스테퍼(제목 줄 + `n / 총`, 현재 스텝 썸네일, `◀ ▶`, `전체 보기`) |
| `ui/history-modal.tsx` | 전체 이력 격자 `ResponsiveModal`(`Grid columns={{base:3, md:5}}`), 실패 칸 포함 |
| `ui/history-card.test.tsx` · `ui/history-modal.test.tsx` | 아래 테스트 참조 |

**수정**

| 파일 | 변경 |
|---|---|
| `model/steps.ts` | `DesignStepCell` 타입 분리 + `DesignHistory`에 `designCells`·`currentIndex` 추가 |
| `model/svg-preview.ts` | 트랙에 인라인이던 타일 배경을 `svgTileStyle()`로 빼 카드·모달이 공유 |
| `model/motif-panel-state.ts` → `model/panel-collapsed.ts` | 키를 인자로 받는 `isPanelCollapsed`/`setPanelCollapsed`로 일반화. 이력 카드는 `design:history-card:collapsed` |
| `ui/design-overlays.tsx` | `DesignOverlayName`에 `"history"` + `HistoryModal` 배선(`historyCells`·`historyCurrentRunId`·`onSelectStep`) |
| `pages/design/index.tsx` | `left`가 `VStack`(MotifPanel + HistoryCard), `bottom`은 PromptBar만. `selectStep`을 카드·모달이 공유 |

## 플랜과 달라진 점

1. **base에서 `◀ ▶`를 세로로 세웠다.** 60px 카드의 내부 폭은 46px이라 화살표 둘을 가로로 놓으면
   각 21px — inclusive-design의 클릭 타깃 최소 24×24를 못 지킨다. `direction={{base:"column",
   md:"row"}}` 한 줄로 base만 세로 배치(md는 플랜대로 `[◀] 라벨 [▶]` 가로).
2. **카드 props는 `currentRunId` 대신 `currentIndex`.** 모델이 이미 계산하므로 카드에서 다시
   `findIndex` 하지 않는다. 모달은 플랜대로 `currentRunId`를 받는다(격자 전체에서 현재 칸을 찾음).
3. **모달의 현재 칸은 activate 없이 닫기만 한다** — 같은 런으로 되돌리는 빈 요청을 막는다.
   실패 칸은 버튼이 아니다(플랜대로).
4. **접기 추가(플랜 밖, 실행 중 요청).** 두 카드의 통일감을 위해 이력 카드에도 모티프 카드와 같은
   접기를 넣었다 — 제목 줄(`이력` + `n / 총` + 셰브론)은 남고 스테퍼·`전체 보기`가 24px 미니 칩
   하나로 접힌다. 미니 칩은 모티프와 같이 표시 전용이고, 접힘은 localStorage에 남는다.
   base(제목 줄이 없는 폭)는 모티프와 같은 규칙으로 접힘과 무관하게 스테퍼를 그대로 둔다.

## 테스트

- `model/steps.test.ts` — `designCells`·`currentIndex` 단언 추가(실패 칸을 건너뛴 번호 기준).
- `ui/history-card.test.tsx` (6건) — 양끝 화살표 잠금, 이웃 `runId`로 `onSelect`, `적용 중` 잠금,
  디자인 없으면 카드 자체가 없음, 접으면 제목 줄만 남고 토글이 상태를 뒤집음, base에서는 접힘과
  무관하게 스테퍼가 남고 `전체 보기`만 트리에서 빠짐.
- `ui/history-modal.test.tsx` (2건) — 실패 칸은 격자에만 남고 버튼이 아님, 칸 선택이 `onSelect` +
  닫힘 / 현재 칸은 닫기만.
- `pages/design/index.test.tsx` — 트랙 기준 2건을 카드 기준으로 재작성(`◀` 클릭이 activate ·
  끝에서 `▶` 잠금 / 적용 중에 입력창과 되돌리기가 함께 잠김).

`pnpm lint`(하네스 포함) · `tsc --noEmit` · store 204건 · admin 233건 통과. `pnpm turbo build`는
로컬에 `VITE_API_BASE_URL`·`VITE_TOSS_CLIENT_KEY`가 없어 vite config가 먼저 throw 하는 것이고
(main도 동일), 두 값을 주면 통과한다.

## 브라우저 확인 (Aside, 로컬 :3000 · 1440×900)

콘솔·페이지 오류 0건.

1. 카드가 모티프 카드 아래 같은 폭(152px)으로 뜨고 `이력 / 1 · 1`, 썸네일에 brand 2px 링,
   스텝이 하나뿐이라 `◀ ▶` 둘 다 비활성 + 라벨 `현재`.
2. `전체 보기` → 이력 모달, 현재 칸 `1 · 현재`.
3. 모달에서 현재 칸 클릭 → `/steps/activate` 요청 0건으로 닫히고 포커스가 `전체 보기`로 복귀.
4. 접기 → 두 카드가 제목 줄 + 미니 칩으로 나란히 축소, 새로고침 후에도 유지
   (`design:history-card:collapsed=1`), 다시 펼치면 키가 지워진다.

`◀ ▶`의 실제 이동은 브라우저에서 확인하지 않았다 — 로컬 세션에 스텝이 1개뿐이라 생성을 한 번
돌려야 했고, 토큰·모델 호출을 쓰지 않기로 했다. 되돌리기 호출 자체는 페이지 테스트(`◀` 클릭 →
`activateStep` 호출 인자 단언)와 카드 테스트가 덮는다. 모바일 390은 Aside가 뷰포트를 못 줄여
`matchMedia` 스텁 테스트로 대체했다.
