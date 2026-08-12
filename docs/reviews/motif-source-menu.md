# 모티프 바꾸기 재설계 — 소스는 들어오기 전에 정한다

실행일: 2026-08-01

범위: `docs/plans/motif-source-menu.md` 전체(1–7단계). 모티프 모달 하나가 6개 경로를 동시에
펼치던 구조를 없애고, 슬롯을 누르면 열리는 **소스 Menu**가 무엇으로 넣을지 묻는 유일한 자리가 됐다.
모달은 소스 하나만 하는 단일 목적 화면이 됐고, SVG는 모달 없이 파일 선택 → 즉시 저장·교체다.

## 결과

| 완료 판정 | 상태 |
|---|---|
| 1. file input의 cancel이 모달을 닫지 않음 | ✅ `use-dialog.ts` 타깃 가드 + `modal.test.tsx` 회귀 2건(가드 제거 시 실패 확인) |
| 2. 소스를 묻는 곳이 Menu 하나 | ✅ 빈 슬롯·미리보기·편집 버튼이 모두 같은 `SlotMenu`를 연다 |
| 3. 모달에 소스 피커·칩 행·유료 행 없음 | ✅ `motif-modal.tsx`는 `state.source`로 제목·본문·footer만 고른다 |
| 4. 생성 확인 모달 삭제 | ✅ `motif-generate-modal.tsx` 삭제, `"motif-generate"` 오버레이·`switchOverlay` 제거 |
| 5. 생성 결과가 적용 없이 내 모티프에 남음 | ✅ api가 `UserMotif` 링크 생성 + `saved` 반환, 브라우저에서 미적용 상태로 목록 노출 확인 |
| 6. SVG는 모달을 열지 않음 | ✅ 페이지 테스트가 `openDialogs() === []`를 고정, 브라우저에서 snackbar만 뜨는 것 확인 |

## 단계별 반영

### 1. shared — `use-dialog.ts` onCancel 타깃 가드

`onCancel`에서 `event.target !== dialogRef.current`면 그대로 흘려보낸다. `<input type="file">`의
`cancel`은 `bubbles: true`라 dialog까지 올라와 ESC로 오인됐다. 신규 `packages/shared/src/components/modal.test.tsx`가
① 내부 file input의 cancel로는 `onOpenChange`가 호출되지 않고 ② dialog 자신의 cancel은 그대로 닫는 것을 고정한다.

### 2. store — `use-motif-search.ts` 소스별 상태

- `MotifSource` 5종(`search|library|generate|text|photo`). SVG는 모달이 없어 소스 상태가 없다.
- `openSlot(slot, source)`는 **슬롯이 바뀔 때만** 전체 초기화한다.
- `candidates`·`addCandidate` 삭제 → `MotifCard`는 `motifId`를 항상 가지므로 `svg`·`key` 필드도 사라졌다.
- `addSvgFile(slot, file)`: 읽기 → import → activate를 한 번에. 진행 중 `pendingSlot` 노출, 결과는 snackbar.
- `addPhotoFile(file)`: 파일 행(이름·용량·objectURL)을 먼저 세우고 배경 제거 결과(`svg`)를 뒤에 채운다.
  파라미터는 `removeBackground: true`로 고정. 색상 수·단순화 옵션은 없고 GPT Image 생성과
  같은 가변 팔레트 중간색 정리·VTracer medium 경로를 사용한다.
- `generate()`는 activate하지 않고 `generated`(+`saved`)를 들고 있다가 `applyGenerated()`가 교체한다.
- `addText()`는 검색어 재사용을 끊고 자체 `text`·`fontId`·`fontWeight`를 갖는다. 글꼴·굵기 변경은
  결과가 있을 때 즉시 재렌더(무료·결정적이라 확인 버튼 없음).
- `notify` 콜백 추가 — 모달 밖(SVG 직행) 결과는 페이지의 snackbar로만 말한다.

### 3. store — `motif-panel.tsx`

슬롯의 모든 진입점이 shared `Menu`를 연다. 그룹 라벨 `고르기`(탐색·내 모티프) / Divider /
`만들기`(AI 생성·글자 넣기·사진에서 따오기·SVG 올리기), 각 항목에 아이콘·보조 문구.
AI 생성 줄에만 `Badge`로 남은 횟수를 붙이고 소진 시 항목을 disabled한다.
숨은 file input 2개가 모달에서 여기로 이사했고, 어느 슬롯이 열었는지는 `fileSlot` ref가 기억한다.
`pendingSlot`인 슬롯은 썸네일 자리에 `ProgressCircle` + "올리는 중…"을 그린다.

shared `MenuItem`에 `description` prop을 추가했다(라벨 아래 한 줄 보조 문구). 기존 `VStack gap="x0_5"`가
이미 두 줄을 전제한 구조라 레이아웃 변경 없이 슬롯만 채웠다.

### 4. api — 생성 결과를 내 모티프에 저장

- `_save_generated_motif()` — `advisory_xact_lock("user-motif:{user}")` → 링크 있으면 그대로(멱등) →
  `MAX_USER_MOTIFS` 초과면 **저장만 건너뛴다**(생성은 성공). 이름은 프롬프트(trim, 100자).
- `MotifGenerateOut.saved: bool` 추가 → 프론트가 "저장했어요"와 "가득 차 저장하지 못했어요"를 가른다.
- `list_user_motifs`의 `Motif.source == "user_upload"` 필터 제거. 생성 모티프는 `source="recraft"`라
  걸러졌다. 링크는 import와 generate만 만들므로 링크 존재가 곧 "내가 만든 것"이다.
  `_resolve_user_motifs`·`_ensure_motif_access`의 필터는 건드리지 않았다.
- 순서: `_motif_results()`로 카탈로그 존재를 먼저 확인한 뒤 링크를 만든다 — 워커가 모티프를 남기지
  못한 경우의 깨끗한 502("생성한 모티프를 카탈로그에서 찾을 수 없습니다")를 FK IntegrityError로
  바꾸지 않기 위해서다. 그래서 응답의 `motif.name`은 카탈로그 subject, 내 모티프 이름은 프롬프트다.
- testcontainers 테스트 2건: 생성 → 링크·목록 노출·재생성 멱등 / 100개 한도에서 `saved=false`·200 유지.
- `pnpm codegen` 산출물(`openapi.json`, `types.gen.ts`) 동봉.

### 5. store — `motif-modal.tsx` 단일 목적 5종

`HEADERS` 레코드가 소스별 제목·설명("슬롯 N에 …")·size를 고르고, 본문·footer만 분기한다.
소스 전환 UI는 없다 — 다른 방법은 닫고 슬롯을 다시 누른다.

- 탐색: TextField(prefix 아이콘 + suffix `찾기`) + "추가 비용이 없어요" + 결과 그리드 + [이 그림으로 바꾸기]
- 내 모티프: 입력 없이 그리드(삭제 포함) + 같은 footer. 삭제 choreography는 현행 유지
- AI 생성: 프롬프트(100자 카운터·남은 횟수) + 예시 칩 3개 + 팁 3줄 → 진행 블록 → 결과 한 장 +
  저장 안내 + [다시 만들기 · N번][이 그림 적용]. 실패는 critical Callout("횟수는 줄지 않았으니…")
- 글자 넣기: 자체 입력(20자) + 글꼴 FieldButton+Menu + 굵기 SegmentedControl + 결과 한 장 + [이 그림 적용]
- 사진에서 따오기: 파일 행(썸네일·이름·용량·[다른 사진]) + 진행 블록 → 사진↔배경 제거 대조 +
  "배경만 지웠어요" + 워커 warnings + [취소][확정]. 파일 input은 이 모달이 직접 갖는다(1단계 가드가 전제)

### 6. store — 배선

`design-overlays.tsx`에서 `"motif-generate"` 오버레이와 `switchOverlay`가 사라졌고,
페이지는 `onPickSource`/`onAddSvg`/`onAddPhoto`를 각각 `ensureAuth()` 뒤에 배선한다.
사진은 `openSlot(slot,"photo") + addPhotoFile(file) + setOverlay("motifs")` 한 묶음이다.

## 검증

- `pnpm lint`(harness 포함) ✅ / `pnpm turbo typecheck` ✅ / store·admin·shared 테스트 303건 ✅ /
  `uv run pytest` 1214건 ✅ / `uv run ruff check .` ✅ / `uv run pyright` ✅
- `pnpm --filter store build`는 `VITE_API_BASE_URL`·`VITE_TOSS_CLIENT_KEY`를 주면 통과한다
  (변수 없이 실패하는 것은 이번 변경 전에도 같은 기존 동작).
- 페이지 테스트 갱신: 탐색·빈 결과·생성 2단계·예산 소진(메뉴 항목만 잠김)·SVG 직행 5건.
  모두 base 브레이크포인트(모바일 390) 렌더라 Menu·BottomSheet 변형이 함께 검증된다.
- Aside 브라우저 실측(로컬 store 3000 / api 8000 / worker 8001, 데스크톱 뷰포트, 콘솔 오류 0):
  슬롯 → Menu 6항목·배지 "3번 남음" → 탐색 검색·교체 성공(이력 1/1→2/2) → 글자 넣기(굵게 전환 시
  즉시 재렌더) 적용 성공 → AI 생성(래더 히트, 예산 환급) 결과 한 장·"내 모티프에 저장했어요" →
  적용하지 않고 닫은 뒤 내 모티프 목록에 생성물 노출 확인 → SVG 파일 선택 시 모달 없이
  snackbar "그림을 넣었어요 · 내 모티프에 저장했어요" → 사진 대조 모달 후 확정까지.

## 계획과 다르게 한 것

- **글꼴 Menu의 실물 미리보기 없음**: 나눔고딕·나눔명조 웹폰트가 store에 없어 각 항목을 그 글꼴로
  렌더할 수 없다. 임의 `font-family` 지정은 하네스 규칙 위반이라 이름 + 보조 문구("반듯하고 잘
  읽혀요" / "붓 느낌의 세리프예요")로 대체했다. 실물 미리보기를 원하면 폰트 파일 반입이 선행이다.
- **생성 응답의 `motif.name`은 프롬프트가 아니다**(위 4단계 순서 근거). 내 모티프 이름만 프롬프트다.
- `docs/CHECKLIST.md`는 갱신하지 않았다 — 이 문서는 미완료 운영 항목만 유지하는데, 이번 작업은
  거기에 새로 남길 미완료 항목이 없다.

## 남은 것 (제안)

- 워커 warnings가 영문 원문 그대로 노출된다(예: "automatic separation is limited to flat
  border-connected backgrounds"). 고객 화면 문구는 한국어로 매핑하는 편이 낫다 — 별도 작업.
- 글꼴 추가(폰트 파일+해시+api·worker Literal 확장), `letter_spacing` UI, 사진 재보정은 범위 밖.
