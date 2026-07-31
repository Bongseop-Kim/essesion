# 4단계 — store 캔버스 셸 재구성

> 총괄: `00-overview.md`. 선행: 1·2단계(서버 계약이 단일 디자인 + patch로 바뀐 뒤).
> 목표 화면: <https://claude.ai/code/artifact/a6d6ae6b-92ba-4e49-907f-cebc97ea8bf7> (01·02·05·06 화면)

## 목표

좌우 2패널·카드 테두리·채팅 피드를 없애고 **넥타이가 화면을 채우는 캔버스**로 바꾼다.
컨트롤은 캔버스 위에 떠 있는 4개 그룹(좌 모티프 패널 / 우 아이콘 레일 / 하단 이력·입력창 /
상단 알림·뷰·토큰)뿐이다.

## 화면 구조 (목업과 1:1)

```
GNB (기존 유지)
캔버스(풀블리드, bg.layer-basement, 넥타이 중앙, 하단 컨트롤 공간 확보)
 ├ 좌상단  : 만드는 방법 pill  → OnboardingDialog
 ├ 우상단  : 토큰 pill(클릭=잔액 상세) + 뷰 세그먼트(넥타이 / 타일 아이콘)
 ├ 상단중앙: 알림 레이어(absolute) — 노랑=자동 조정 경고, 빨강=범위 밖 거절
 ├ 좌측(상단 정렬): 모티프 카드 — 제목 `모티프 n/2` + 접기, 슬롯 2개(썸네일 → 이름 + 편집)
 ├ 우측(상단 정렬): 레일 2열
 │    왼쪽 열: 내려받기 · 실사화        (도구와 같은 원형 아이콘 + 라벨)
 │    오른쪽 열: 참고 사진 · 색 지정 · 내 디자인 · 완성본 · 새로 시작
 └ 하단중앙: 편집 이력 썸네일(64px, 가로) + 입력창 pill(문장 + 아이디어 + 전송)
```

- 좌·우 패널은 세로 **상단 정렬**(플로팅 pill 아래). 중앙 정렬 아님.
- 알림은 absolute 레이어라 **캔버스·이력·입력창을 밀지 않는다.**
- 모바일(390): 레일은 라벨 없이 **아이콘 1열 7개**, 모티프 카드는 썸네일만 2칸,
  모티프 모달은 BottomSheet.

## 상태

| 상태 | 화면 |
|---|---|
| 편집 중 | 위 구조 그대로. 이력 마지막 = `현재` 링 |
| 적용 중 | 프리뷰·이력 유지, 이력 끝에 스켈레톤 칸 1개, 입력창 잠금 + 전송 버튼 스피너, 레일·모티프 카드 흐리게 |
| 실패 | 이력에 점선 빨강 `실패` 칸, 현재 디자인·포인터 불변(토큰 환불은 서버가 처리) |
| 범위 밖 거절 | 상단 빨강 알림 1줄 + 입력창 문장 **전체 선택 하이라이트**, 이력 변화 없음 |
| 첫 진입 | 캔버스 중앙 안내(아이콘 + 제목 + 설명), 모티프 슬롯 2칸 비어 있음, 내려받기·실사화 비활성 |
| 되돌리기 | 이력 썸네일 클릭 → `POST /design/sessions/{id}/steps/activate`. 별도 버튼 없음 |

## 삭제

| 파일 | 이유 |
|---|---|
| `features/design/ui/turn-feed.tsx`(+test) | 채팅 피드 폐기 |
| `features/design/ui/candidate-grid.tsx` | 후보 폐기 |
| `features/design/ui/composer.tsx`(+test) | 새 입력창으로 교체(`+` 패널·후보 개수·모드 칩 전부 없음) |
| `features/design/ui/preview-panel.tsx` | 캔버스가 대체 |
| `features/design/ui/preview-modal.tsx` | 확대 모달 없음 |
| `features/design/ui/pattern-settings-modal.tsx` | 3단계에서 계약 폐기 |
| `features/design/ui/finalize-turn-card.tsx`, `model/finalize-turns.ts`(+test) | 피드용 |
| `features/design/model/selection.ts`·`use-selection.ts`(+test) | 후보 선택 상태 |
| `features/design/model/turn-payload.ts`의 candidate 파트 | 1단계 payload 변경 반영 |
| `features/design/ui/generation-controls.test.tsx` | 대상 컴포넌트 소멸 |

## 유지 (연결만 새 위치로)

- `onboarding-dialog`(만드는 방법) · `session-list-modal`(내 디자인) · `finalized-list-modal`(완성본)
  · `export-dialog`(내려받기) · `finalize-dialog`(실사화) · `color-settings-modal`(색 지정)
  · `ideas-modal`(입력창 sparkles)
- `model/queries.ts`·`svg-preview.ts`·`errors.ts`·`warnings.ts`·`use-delete.ts`·`use-finalize-job.ts`
  ·`onboarding.ts`·`pending.ts`(생성 중 이탈 복구)·`operation-epoch.ts`(경쟁 가드)·`api/attachments.ts`
- `ui/design-picker.tsx`는 **디자인 페이지 소유가 아니다** — `pages/custom-order`가 쓴다. 건드리지 않는다.

## 신규 (전부 store 로컬 — shared에 올리지 않는다)

`features/design/ui/`에 추가:

| 컴포넌트 | 내용 |
|---|---|
| `design-canvas.tsx` | 풀블리드 캔버스 + TieCanvas(넥타이/타일 모드) + 빈 상태 |
| `motif-panel.tsx` | 좌측 모티프 카드(슬롯 2개, 접기) — `current_motifs` 소비 |
| `tool-rail.tsx` | 우측 레일 2열(액션 2 + 도구 5), 비활성 상태 |
| `history-track.tsx` | 하단 이력 트랙(64px 썸네일, 현재/실패/대기 칸) |
| `prompt-bar.tsx` | 입력창 pill(문장·아이디어·전송, 잠금·하이라이트 상태) |
| `canvas-notice.tsx` | 상단 알림 레이어(2톤) |
| `view-toggle.tsx` | 넥타이/타일 세그먼트 |
| `token-pill.tsx` | 잔액 pill + 상세 |

`pages/design/index.tsx`는 위 조각을 조립하는 컨테이너로 다시 쓴다. 현재 1597줄 → **목표 400줄
이하**. 상태 관리는 지금처럼 react-query + 로컬 state를 쓰고 전역 스토어를 새로 도입하지 않는다.

## 하네스 규칙 (위반 시 `pnpm lint` 차단)

- 레이아웃은 프리미티브(`Box`/`Flex`/`HStack`/`VStack`/`Grid`/`Float`)만. raw `<div>` + Tailwind
  레이아웃 클래스 금지.
- 시각값은 토큰만(`bg.*`/`fg.*`/`stroke.*`/`x*`/`r*`/`s1–s3`). 목업의 회색·라운드·그림자는
  전부 기존 토큰으로 매핑된다(캔버스 = `bg.layer-basement`, 카드·pill = `bg.layer-floating` +
  `stroke.neutral-weak` + `s1`, 모달 = `s3`).
- 타이포는 `Text` + `textStyle`. 아이콘은 `Icon` + `@heroicons/react`
  (필요 아이콘: ArrowDownTray, Squares2X2, Photo, Swatch, FolderOpen, Bookmark, Plus,
  PencilSquare, LightBulb, CreditCard, Sparkles, PaperAirplane, ChevronDown,
  ExclamationTriangle, MagnifyingGlass, ArrowUpTray, Camera, Language, PaintBrush).
- 캔버스 위 절대배치는 `Float`를 우선 검토하고, 9앵커로 안 되면 `Box position="absolute"` + 토큰.
- 표현 불가한 값이 나오면 임의 값으로 우회하지 말고 **멈추고 shared에 토큰 추가를 제안**한다.
- 가로 스크롤(이력 트랙)은 `ScrollFog direction="horizontal"`만 사용.

## 미결 M2 — 모티프 카드 접힘

권고: 접으면 제목 줄만 남고 썸네일 2칸이 24px 미니 칩으로 축소. 상태는 localStorage에 저장
(`onboarding.ts`와 같은 패턴). 착수 시 확정해 이 문서에 기록한다.

## 검증

- `pnpm turbo build typecheck test` — 삭제된 컴포넌트 테스트 제거, 신규 컴포넌트 테스트 작성
  (이력 클릭 → activate 호출, 거절 시 문장 유지·하이라이트, 적용 중 잠금)
- `pnpm lint` (하네스 정적 검사 포함)
- Aside 브라우저: `localhost:3000/design` 실제 세션으로 편집 → 되돌리기 → 실사화, 1440·390 두 폭,
  콘솔 오류 0

## 완료 판정

1. 화면이 목업 01·02·05·06과 구조적으로 일치한다(패널 4그룹, 카드 테두리 없음)
2. 알림이 떠도 넥타이·이력·입력창의 위치가 변하지 않는다
3. `pages/design/index.tsx`가 400줄 이하
4. 삭제 목록의 파일이 존재하지 않고 참조도 없다
