# 편집 이력을 좌측 카드 스테퍼로 (store /design)

> 목업: <https://claude.ai/code/artifact/3eccd3a6-710d-46ef-a8ca-bf52e7c1814d> (D-1 컷)
> 선행 없음. store 프론트만 손댄다 — API·스키마·워커 변경 없음.

## 목표

하단 가로 이력 트랙(`history-track.tsx`)이 입력창과 함께 캔버스 아래 190px를 차지해 넥타이가
430px로 눌린다. 이력을 **좌측 컬럼의 카드 스테퍼**로 옮겨 캔버스 하단에는 입력창만 남기고,
넥타이가 남는 높이를 그대로 채우게 한다(같은 1440×900 기준 430 → 560px).

되돌리기 동작 자체는 그대로다: `POST /design/sessions/{id}/steps/activate`로 포인터만 옮긴다.

## 화면 구조

```
좌측 컬럼(상단 정렬, 152px)
 ├ 모티프 카드            (기존 motif-panel, 그대로)
 └ 이력 카드  ← 신규
      제목 줄 : `이력`  ·  우측에 `n / 총` (tabular-nums)
      썸네일  : 현재 스텝, 카드 폭 정사각, 2px stroke.brand
      네비    : [◀] `현재`(또는 `n번째`) [▶]   — 양끝에서 각각 비활성
      바닥    : `전체 보기`  → 이력 모달
하단 중앙: 입력창(prompt-bar)만. 이력 트랙 제거.
```

- 이력 카드는 모티프 카드와 같은 폭·라운드·그림자(`bg.layer-floating` + `r3` + `s1`).
- 모바일(base, 60px 컬럼): 썸네일 + `◀ ▶`만. 제목 줄·`현재` 라벨·`전체 보기`는 `md`부터이고,
  base에서는 **썸네일 탭이 모달 진입점**을 겸한다(모티프 카드와 같은 규칙).
- 이력 모달: `ResponsiveModal`(PC 중앙 · 모바일 BottomSheet), `Grid columns={{ base: 3, md: 5 }}`,
  칸을 누르면 그 스텝을 activate 하고 모달을 닫는다.

## 상태

| 상태 | 이력 카드 |
|---|---|
| 스텝 1개(첫 생성 직후) | 카드는 뜨되 `◀ ▶` 둘 다 비활성, `1 / 1` |
| 편집 중 | 현재 스텝 썸네일 + `n / 총`. 마지막이면 `▶` 비활성 |
| 되돌린 상태 | 라벨은 `n번째`(현재 아님), `▶`로 앞으로 다시 이동 가능 |
| 적용 중 | 썸네일 자리에 `Skeleton`, 라벨 `적용 중`, `◀ ▶`·`전체 보기` 잠금 |
| 실패 | 카드는 불변(현재 디자인·포인터 유지). 실패 칸은 **모달 격자에만** 점선 빨강으로 |
| 디자인 없음(첫 진입) | 카드 자체를 렌더하지 않는다(지금 트랙과 동일) |

## 파일

**삭제**

| 파일 | 이유 |
|---|---|
| `features/design/ui/history-track.tsx` | 가로 트랙 폐기 |

**신규** (`features/design/ui/`)

| 파일 | 내용 |
|---|---|
| `history-card.tsx` | 좌측 카드 스테퍼. props: `cells`·`currentRunId`·`pending`·`disabled`·`onSelect(runId)`·`onOpenAll` |
| `history-modal.tsx` | 전체 이력 격자 모달. props: `open`·`onOpenChange`·`cells`·`currentRunId`·`onSelect` |

**수정**

| 파일 | 변경 |
|---|---|
| `model/steps.ts` | `DesignHistory`에 `designCells`(kind `design`만)·`currentIndex` 추가. 기존 필드·계산은 그대로 |
| `ui/design-canvas.tsx` | 변경 없음 — `bottom`에서 이력을 빼는 건 페이지 쪽. 하단 여백이 줄어 넥타이가 자동으로 커진다 |
| `ui/design-overlays.tsx` | `DesignOverlayName`에 `"history"` 추가 + `HistoryModal` 배선(`cells`·`currentRunId`·`onSelect`를 페이지에서 받는다) |
| `pages/design/index.tsx` | `left`에 `VStack gap="x3"`로 `MotifPanel` + `HistoryCard`. `bottom`은 `PromptBar`만. `activateStep` 호출은 카드·모달이 공유(기존 `runOnSession` 재사용) |

`steps.ts`의 `label`은 지금처럼 design 칸만 센다 — 스테퍼의 `n / 총`은 `designCells` 기준이고
실패 칸은 번호를 차지하지 않는다. `◀`/`▶`는 `designCells[currentIndex ∓ 1].runId`로 activate 한다.

## 하네스 규칙

- 레이아웃은 프리미티브만(`VStack`/`HStack`/`Box`/`Grid`), 시각값은 토큰만.
- 카드 안 세로 스크롤 없음 — 스테퍼는 한 칸만 보여준다. 모달 격자가 길어지면 모달 자체 스크롤.
- 버튼 비활성은 `opacity-50`(버튼류 규칙), 현재 칸은 `aria-current="step"`.
- 문구는 기존 트랙과 같은 톤: `n번째 디자인으로 되돌리기` / `n번째 디자인, 현재 편집 중`.

## 테스트

- `pages/design/index.test.tsx`
  - `"이력 썸네일 클릭이 그 스텝을 activate 한다"` → **`◀`(이전 디자인) 클릭이 activate 한다**로 재작성.
    현재 스텝에서 `▶`가 비활성인 것도 함께 본다.
  - `"적용 중에는 입력창을 잠그고 이력 끝에 대기 칸을 만든다"` → 대기 칸 대신 **카드가 `적용 중`으로 잠긴다**.
- 신규 `ui/history-card.test.tsx`: 양끝 비활성, `onSelect`가 이웃 `runId`로 불린다, `pending`이면 잠금.
- 신규 `ui/history-modal.test.tsx`: 실패 칸이 격자에 뜨고 누를 수 없다, 칸 선택이 `onSelect` + 닫힘.

## 검증

```bash
pnpm lint
pnpm turbo build typecheck test
```

브라우저 확인은 Aside로 `/design`을 열어 ① 넥타이가 커졌는지 ② `◀ ▶`로 되돌아가는지
③ 모바일 폭에서 카드가 썸네일 + 화살표만 남는지(matchMedia 스텁 테스트로 대체 가능).

## 하지 않는 것

- API·`steps/activate` 계약 변경, 이력 페이지네이션.
- 모티프 카드 레이아웃 변경(접힘 상태 포함).
- D-2(좌하단 pill) 배치 — D-1로 확정, 필요해지면 별도 플랜.
