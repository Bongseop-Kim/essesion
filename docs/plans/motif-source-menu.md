# 모티프 바꾸기 재설계 — 소스는 들어오기 전에 정한다

목업: https://claude.ai/code/artifact/604f94bf-0250-4ada-9540-423424f8db3e (컷 번호는 이 문서 기준)

## 무엇을 바꾸나

지금 모티프 모달 하나가 6개 경로(탐색·내 모티프·AI 생성·글자·사진·SVG)의 컨트롤을 동시에 펼친다.
이를 다음 구조로 바꾼다.

- 슬롯(빈 슬롯·편집 공통)을 누르면 **소스 Menu**가 먼저 열린다. 소스를 묻는 곳은 여기 하나다. (컷 01)
- 모달은 소스 하나만 하는 **단일 목적 화면**이 된다. 모달 안에 소스 피커·칩 행·유료 행은 없다. (컷 02–04, 06–07)
- **SVG 올리기는 모달 없이** 파일 선택창 → 즉시 import+activate. 슬롯에 진행 스피너를 보여준다. (컷 05)
- **사진에서 따오기**는 파일 선택창이 먼저, 그 뒤 배경 제거 결과를 대조로 보여주는 확인 모달. (컷 06)
- **생성 확인 모달(motif-generate-modal)은 삭제**한다. Menu → 프롬프트 입력 → ✨ 3단계가 오발을 막는다. (컷 03)
- 생성·글자 결과는 그리드에 쌓지 않고 **결과 한 장**으로 보여준 뒤 [적용]한다. `candidates` 상태는 사라진다.
- AI 생성 결과는 **적용하지 않아도 내 모티프에 저장**된다 — api 변경 필요(4단계).

해결하는 문제: ① SVG 선택 취소가 모달을 닫음(shared 버그) ② 검색 입력이 글자 모티프에 재사용됨
③ 한 모달에 기능 과밀 ④ 그림 추가를 Menu로 고르고 싶다 ⑤ 만들기 경로의 비중이 작다.

## 실행 순서

각 단계는 독립 커밋 가능. 1은 선행 버그픽스, 4는 api+codegen, 나머지는 store.

### 1. shared: `use-dialog.ts` onCancel 타깃 가드 (선행, 독립 배포 가능)

`<input type="file">`은 선택창을 취소하면 `bubbles: true`인 `cancel` 이벤트를 내고,
이것이 `<dialog>`까지 올라가 `use-dialog.ts`의 `onCancel`이 ESC로 착각해 모달을 닫는다.
이번 재설계로 모티프 파일 경로는 모달 밖으로 나가지만, 사진 확인 모달(6단계)과
AttachmentDisplayField를 쓰는 다른 모달에는 그대로 남는 버그라 먼저 고친다.

`packages/shared/src/components/internal/use-dialog.ts`:

```ts
onCancel: (event) => {
  if (event.target !== dialogRef.current) return; // 내부 file input의 cancel은 내 것이 아니다
  event.preventDefault();
  if (closeOnEscape) onClose();
},
```

회귀 테스트 1개(`packages/shared/src/components/modal.test.tsx` 또는 신규 파일):
Modal 안에 file input을 렌더 → input에 `new Event("cancel", { bubbles: true })` 디스패치 →
`onOpenChange(false)`가 **호출되지 않아야** 한다. dialog 자신의 cancel은 기존대로 닫는다.

### 2. store: `use-motif-search.ts` — 소스별 상태로 재구성

`apps/store/src/features/design/model/use-motif-search.ts`:

- `MotifSource`를 5종으로: `"search" | "library" | "generate" | "text" | "photo"`.
  SVG는 소스 상태가 없다(모달이 없으므로).
- `openSlot(slot, source)` — 슬롯이 **바뀔 때만** 전체 초기화. 같은 슬롯에서 소스만 바꾸면
  이전 소스의 입력·결과는 유지된다(어차피 만들기 결과는 즉시 저장/적용되므로 잃는 게 없다).
- `candidates`·`addCandidate` 삭제. 그리드는 탐색 결과와 내 모티프만 그린다.
  `cards`의 "지금 쓰는 그림" 첫 칸 로직은 유지.
- `addSvgFile(slot, file)`: `readDesignMotifSvg` → `importDesignMotifSvg` → activate까지 **한 번에**.
  진행 중 `pendingSlot: 1 | 2 | null`을 노출해 패널 슬롯이 스피너를 그린다.
  실패는 snackbar(모달이 없으니 Callout 자리도 없다). 성공 snackbar: "그림을 넣었어요 · 내 모티프에 저장했어요".
- `addPhotoFile(file)`: `uploadDesignPhoto` → `previewPhotoMotif` 결과를 상태로 **들고만 있는다**
  (`photoResult: { svg, warnings, name } | null` + 원본 미리보기용 object URL).
  `confirmPhoto()`가 import+activate. "다른 사진"은 파일 input을 다시 연다.
  파라미터는 배경 제거만 남긴다: `removeBackground: true, simplification: "low", colorCount: 6`
  — 목업 문구 "색과 모양은 사진 그대로예요"의 근거. 단순화 옵션·그 경고 UI는 두지 않는다
  (워커 warnings는 오면 힌트 아래 표시).
- `generate()`: 성공해도 바로 activate하지 않고 결과를 들고 있는다
  (`generated: { motifId, name, saved } | null`). `applyGenerated()`가 activate.
  재호출(다시 만들기)은 이전 결과를 대체한다. 성공 시 `listUserMotifsQueryKey` invalidate
  (api가 내 모티프에 저장하므로 — 4단계). `recraft_budget_exhausted` 시 세션 재조회는 현행 유지.
- `addText()`: 검색어 재사용을 끊고 **자체 상태**를 갖는다 —
  `text`(최대 20자), `fontId: "nanum-gothic" | "nanum-myeongjo"`, `fontWeight: 400 | 700`.
  `letterSpacing`은 0 고정, UI 없음. 글꼴·굵기를 바꾸면 결과가 있을 때 **즉시 재생성**
  (무료·결정적이라 확인 버튼 없음). 결과는 `textResult: { svg } | null`로 들고 있다가
  `applyText()`가 import+activate.
- 글꼴은 워커가 실제 가진 것만: `nanum-gothic`·`nanum-myeongjo` × 400·700.
  늘리려면 폰트 파일+해시 추가와 api·worker 양쪽 `font_id` Literal 확장이 먼저다 — 이번 범위 아님.

### 3. store: `motif-panel.tsx` — 슬롯이 Menu를 연다 + 파일 직행 + pending

`apps/store/src/features/design/ui/motif-panel.tsx` (신규 파일 없이 여기서):

- 빈 슬롯·채워진 슬롯의 미리보기·편집 버튼 모두 shared `Menu`(Root/Trigger/Content/Item)를 연다.
  진입점이 하나면 "여긴 검색만 되나?" 하는 착각이 없다. Menu는 모바일도 같은 컴포넌트(시트 변형 없음).
- Menu 구성(컷 01): 그룹 라벨 "고르기"(탐색·내 모티프) / 구분선 / "만들기"(AI 생성·글자 넣기·
  사진에서 따오기·SVG 올리기). 각 항목에 아이콘+보조 문구. **AI 생성 줄에만** 남은 횟수 배지
  ("N번 남음") — 유일한 유료 경로라 배지 없음이 곧 무료 표시다. 예산 소진 시 AI 생성 항목 disabled.
  props에 `recraftRemaining: number | null` 추가.
- 항목 선택:
  - 탐색·내 모티프·AI 생성·글자 → `onPickSource(slot, source)` — 페이지가 `openSlot` 후 오버레이를 연다.
  - SVG 올리기 → 패널의 숨은 svg input을 직접 연다(모달 건너뜀) → `onAddSvg(slot, file)`.
  - 사진에서 따오기 → 숨은 photo input을 연다 → 파일 선택 후 `onAddPhoto(slot, file)` —
    페이지가 `openSlot(slot, "photo")` + `addPhotoFile(file)` + 오버레이 열기.
  - 취소하면 아무 일도 일어나지 않는다 — 열린 모달이 없으니 닫힐 것도 없다.
- 숨은 file input 2개(svg·photo)는 motif-modal.tsx에서 이리로 이사한다(`DESIGN_SVG_ACCEPT`/`DESIGN_PHOTO_ACCEPT`).
- `pendingSlot`이 이 슬롯이면 썸네일 자리에 ProgressCircle + "올리는 중…" (컷 05-①).
  pending 중 해당 슬롯 트리거는 disabled.

### 4. api: 생성 성공 시 내 모티프에 저장 + codegen

`apps/api/src/api/domains/design/router.py`:

- `_dispatch_motif_generation` 성공 후 `UserMotif` 링크를 만든다 — 이름=프롬프트(trim, 100자),
  import 경로(773행)의 로직 재사용: `advisory_xact_lock(f"user-motif:{user_id}")` → 기존 링크 있으면
  그대로(멱등, reused 포함) → `MAX_USER_MOTIFS`(100) 초과면 **저장만 건너뛴다**(에러 아님).
- `MotifGenerateOut`에 `saved: bool` 추가 — 프론트가 "내 모티프에 저장했어요" vs
  "내 모티프가 가득 차 저장하지 못했어요"를 가른다.
- `list_user_motifs`(851행)의 `Motif.source == "user_upload"` 필터를 제거한다 —
  생성 모티프는 `source="recraft"`라 현행 필터에 걸러진다. `UserMotif` 링크는 import와 generate만
  만들므로 링크 존재 자체가 "내가 만든 것"의 진실이고, 필터 없이도 카탈로그가 새지 않는다.
  (`_resolve_user_motifs`·`_ensure_motif_access`의 user_upload 필터는 **건드리지 않는다** —
  recraft는 private이 아니라 activate에 인가 문제가 없다.)
- 테스트(testcontainers, mock 금지): 생성 성공 → 링크 생성·목록에 노출, 같은 모티프 재생성 →
  링크 1개(멱등), 100개 한도에서 생성 → `saved=false`·생성 자체는 성공.
- **`pnpm codegen` 후 api-client 생성물을 같은 커밋에** (CI 드리프트 검사).

### 5. store: `motif-modal.tsx` — source 5종 단일 목적 모달

한 컴포넌트가 `state.source`로 제목·본문·footer만 고른다. 공통: ResponsiveModal,
제목/설명은 소스별("탐색 — 슬롯 N에 넣을 그림을 문장으로 찾아요" 꼴), 소스 전환 UI 없음
(다른 방법 = 닫고 슬롯을 다시 누른다).

- **탐색** (컷 02): 검색 입력(실행 버튼 내장형은 기존 TextField+suffix로 충분) + 힌트
  "카탈로그에서 고르는 건 추가 비용이 없어요" + 결과 그리드(현재 그림 첫 칸 포함) +
  footer [이 그림으로 바꾸기] 하나.
- **내 모티프** (컷 07): 입력 없음 — 그리드(삭제 버튼 포함)와 footer뿐.
  목록 조회는 이 소스를 열 때만(현행 enabled 조건 유지). 삭제 choreography(닫고 250ms 뒤
  AlertDialog, 닫히면 이 소스로 복귀)는 design-overlays 현행 유지.
- **AI 생성** (컷 03, size small):
  - 처음: 프롬프트 입력(100자·카운터) + 힌트 "이번 디자인에서 N번 더 만들 수 있어요" +
    예시 칩 3개(누르면 입력에 채움) + "잘 나오는 문장" 팁 3줄(사물 하나만 / 단순한 형태 /
    그림체는 지금 디자인을 따라가요 — 서버가 `_plan_style_hint`로 style을 이미 넘기는 게 근거).
  - 만드는 중: 입력 잠금 + 진행 블록 "그림을 그리고 있어요 · 20초쯤 걸려요 · 끝날 때까지 열어 두세요".
  - 실패: critical Callout "그림을 만들지 못했어요. 횟수는 줄지 않았으니 문장을 조금 바꿔
    다시 시도해 주세요"(실패·래더 히트는 `_release_recraft_budget`으로 환급되므로 참말이다).
  - 성공: 결과 한 장 + 힌트 "내 모티프에 저장했어요 — 적용하지 않아도 나중에 다시 고를 수 있어요"
    (`saved=false`면 "내 모티프가 가득 차 저장하지 못했어요") +
    footer [다시 만들기 · N번](neutralOutline) [이 그림 적용](solid).
  - 예산 소진: 입력·실행 잠금 + "이번 디자인에서 더 만들 수 없어요"(현행 동작 유지).
- **글자 넣기** (컷 04, size small): 자체 입력(20자·카운터) + 힌트 "추가 비용 없이 몇 번이든 ·
  최대 20자" + 글꼴 FieldButton+Menu(각 항목 이름을 그 글꼴로 렌더해 미리보기 겸용, 보조 문구
  포함 — 2종이지만 늘어날 자리라 세그먼트가 아니라 Menu) + 굵기 SegmentedControl(보통/굵게) +
  결과 한 장 + footer [이 그림 적용] 하나. 재생성 버튼 없음 — 실행 버튼·글꼴·굵기 변경이 곧 재생성.
- **사진에서 따오기** (컷 06, size small): 파일 행(썸네일·이름·용량 + [다른 사진]) +
  변환 중엔 진행 블록, 완료 시 사진↔배경 제거 결과 대조 + 힌트 "배경만 지웠어요 · 색과 모양은
  사진 그대로예요" + 워커 warnings는 힌트 아래 + footer [취소][확정] — 배경 제거는 사진마다
  갈려서 여기만 두 버튼이다.

UI는 shared 사다리 준수: Menu·SegmentedControl·FieldButton·Chip·Callout·ProgressCircle·
ImageFrame·ContentPlaceholder 등 기존 컴포넌트로 전부 표현 가능해 보인다. 안 되면 멈추고 제안.

### 6. store: 생성 확인 모달 삭제 + 배선

- `apps/store/src/features/design/ui/motif-generate-modal.tsx` **삭제**.
- `design-overlays.tsx`: `"motif-generate"` 오버레이 이름·MotifGenerateModal 렌더·
  `onRequestGenerate`/`switchOverlay("motif-generate")` 경로 제거.
  motif 삭제 choreography는 그대로.
- `pages/design/index.tsx`: `onEditSlot` 대신 패널의 새 콜백을 배선 —
  `onPickSource(slot, source)` → `ensureAuth()` → `motifs.openSlot(slot, source)` →
  `setOverlay("motifs")`. `onAddSvg`/`onAddPhoto`도 `ensureAuth()` 경유.
  `recraftRemaining`을 패널에 내려준다.
- `use-motif-search.ts`에서 `generatePrompt` 프리필(`setGeneratePrompt(query)`) 로직은
  소멸 — 생성 소스가 자체 입력을 가진다.

### 7. 검증

- `pnpm lint` && `pnpm turbo build typecheck test` && `uv run pytest` && `uv run ruff check .` && `uv run pyright`
- api 스펙 변경 커밋에 codegen 산출물 포함 확인.
- Aside 브라우저로 플로우 확인(서버는 보통 떠 있음 — lsof/curl 먼저):
  슬롯 → Menu 6항목, 탐색/내 모티프/생성/글자/사진 각 모달, SVG 직행+슬롯 스피너,
  SVG·사진 파일 선택 **취소 시 아무 일 없음**, 생성 결과가 내 모티프 목록에 나타나는지,
  모바일 390(뷰포트 리사이즈 불가 — matchMedia 스텁 테스트로).
- 완료 후 이 문서를 `docs/reviews/`에 결과 기록으로 옮기고 plans에서 제거, `docs/CHECKLIST.md` 갱신.

## 범위 밖 (제안만)

- 글꼴 추가(폰트 파일+해시+Literal 확장) — 별도 플랜.
- `letter_spacing` UI — 파라미터는 있으나 눈에 띄는 차이가 작아 두지 않는다.
- 사진 재보정 수단(같은 사진 손보기) — 결과가 나쁘면 다른 사진을 고르는 것으로 충분.
