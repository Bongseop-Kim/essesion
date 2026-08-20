# 완성본·첨부 이미지 확대 보기

2026-08-20 기준. store·admin에서 이미지 썸네일을 클릭해 크게 보는 수단을 추가한다.
대상 표면은 (a) 완성본 모달의 browse 카드 이미지 — **모달 안 인라인 콘텐츠 전환**(그리드
↔ 단일 이미지 뷰), (b) `AttachmentDisplayField` 썸네일 중 페이지 컨텍스트 사용처 5곳 —
**기존 Modal 1겹**. "모달 위 모달 금지"(overlay.md)는 그대로 지키고, top-layer 개수는
어느 시점에도 1을 넘지 않는다. 신규 shared 컴포넌트·overlay 상태 머신 변경·API·스키마·
디자인 시스템 규칙 변경은 없다.

## 왜 필요한가

- 실사화 결과(넥타이 실사)는 원본이 2:3인데 완성본 카드는 2열 그리드의 정사각
  `ratio={1}` + `fit="contain"`으로 렌더한다
  (`apps/store/src/features/design/ui/finalized-gallery.tsx:185`) — 화면에서 실제로
  보이는 크기가 원본 대비 매우 작고, 어느 표면에도 확대 수단이 없다(store·shared 전체에
  zoom/lightbox 구현 없음을 2026-08-20 grep으로 확인).
- 완성본 모달(browse variant)의 카드 이미지 영역은 클릭 핸들러가 비어 있다 — 하단
  주문제작·삭제 버튼만 있다(`finalized-gallery.tsx:235` 분기, browse 셸에는 onClick 없음).
  이미지 클릭을 확대에 배정해도 기존 동작과 충돌하지 않는다.
- 첨부 썸네일은 80/112px 고정(`packages/shared/src/components/attachment-display-field.tsx:53`)
  이라 참고 이미지 내용을 확인할 수 없다.
- 크기 근거: Modal medium은 데스크톱 max-w 560px(`packages/shared/src/components/modal.tsx:15`),
  세로는 `--size-modal-max-height`까지. 현재 카드 썸네일(2열, ~250px) 대비 단일 뷰
  전환만으로 폭 2배+, 2:3 실사는 세로가 제한 요인이라 뷰포트 전체 뷰어와 실질 차이가
  작다. 모바일 바텀시트는 이미 풀폭.
- **이미 구현된 것 제외**: "실사화 완료 시 완성본을 자동으로 보여주기"는 이미 있다 —
  finalize는 동기 요청-응답이고 성공 시 다이얼로그 닫힘 모션 후 완성본 모달을 자동으로
  연다(`apps/store/src/pages/design/index.tsx:168`의 `onDone`). 이 플랜에서 다루지 않는다.

## 범위 밖 (non-goals)

- 주문제작 디자인 피커(select variant, `design-picker.tsx`)의 카드 클릭은 **선택** 동작
  유지 — 확대를 붙이지 않는다(클릭 시맨틱이 이미 점유됐고 `<button>` 중첩이 된다).
- 리뷰 작성 모달 안 첨부(`apps/store/src/features/reviews/ui/review-form-modal.tsx:200`)의
  확대 — 모달 안이라 확대 Modal을 겹칠 수 없고, 본인이 방금 고른 파일이라 확대 필요성이
  약하다. 필요 신호가 생기면 재론.
- 핀치줌·팬·회전·이미지 간 스와이프 등 고급 뷰어 제스처. 원본 확인이 목적이다.
- 실사화 완료 자동 표시 흐름 변경(위에서 확인한 대로 이미 존재).
- overlay.md·디자인 시스템 규칙 변경, 신규 shared 오버레이 컴포넌트.

## 실행 조건

- shared 컴포넌트(`AttachmentDisplayField`) 수정이 포함되므로 `packages/shared/AGENTS.md`
  (디자인 시스템 하네스)를 읽고 실행할 것.
- top-layer는 어느 시점에도 1겹 — 확대 Modal은 페이지 컨텍스트에서만 열리고, 모달 안
  표면(완성본 모달)은 인라인 전환으로만 처리한다는 전제가 깨지는 설계로 변형하지 말 것.

## 절차

1. **완성본 모달 browse 카드: 인라인 확대 뷰** —
   `finalized-gallery.tsx`의 browse variant에서 카드 이미지(`:183`의 `body` 중 browse
   분기)를 버튼(`aria-label`: "완성본 N 크게 보기")으로 감싸고, 클릭 시 갤러리 로컬
   상태로 그리드 ↔ 단일 이미지 뷰를 전환한다(모달은 그대로 1겹, 콘텐츠만 교체).
   단일 뷰: 뒤로 버튼 + 큰 `ImageFrame`(`fit="contain"`, 모달 콘텐츠 영역을 채움) +
   기존 카드의 주문제작·삭제 버튼 동선 유지 여부는 뒤로→그리드에서 수행하는 것으로
   충분(단일 뷰에는 뒤로만). 대상 URL은 현재 `previewMode`가 가리키는 것(tie→`tie_url`,
   fabric→`fabric_url`, 레거시 폴백 `result_url` — `:189` 기존 폴백 순서 그대로).
   URL이 전부 null인 레거시 행(폴백 실루엣)은 클릭 비활성. select 분기·DesignPicker는
   손대지 않는다(확대 상태는 browse 전용).
2. **`AttachmentDisplayField`에 opt-in 확대** — `previewable`(boolean, 기본 false) prop
   추가. true면 `attachment-display-field.tsx:82`의 `ImageFrame`을 버튼(`aria-label`:
   "○○ 확대")으로 감싸 클릭 시 기존 `Modal`(제목 없이 `aria-label`, `showCloseButton`,
   내용은 `fit="contain"` 이미지 1장)을 연다 — 신규 컴포넌트 없음. 상태는 컴포넌트
   로컬(선택된 item id 1개). `:89`의 제거 버튼(Float)은 버튼 밖 형제로 유지해 중첩
   버튼을 피한다. blob: URL(파일 미리보기)과 원격 URL 모두 그대로 표시 가능.
   **기본 false인 이유**: 모달 안 사용처(리뷰 작성 모달)에서 켜면 모달 위 모달이 되므로,
   페이지 컨텍스트임을 아는 사용처만 명시적으로 켠다 — prop JSDoc에 이 제약을 적는다.
3. **페이지 사용처 5곳에 `previewable` 활성** — custom-order·sample-order·reform
   tie-item-form·repair-photo-field(store), product-form(admin). 리뷰 작성 모달의
   review-photo-field는 켜지 않는다(non-goals).
4. **접근성 확인** — 인라인 전환 시 포커스를 뒤로 버튼으로 이동, 뒤로 시 원래 카드로
   복원. 확대 Modal은 use-dialog가 포커스 트랩·복원을 제공하는지 확인. 썸네일 버튼에
   focus-visible 링.

## 검증

- `pnpm lint && pnpm typecheck && pnpm test` (check-harness 포함) 통과.
- aside-browser로 실측:
  - store /design → 실사화 완료 → 자동으로 뜬 완성본 모달에서 이미지 클릭 → 모달 안에서
    단일 이미지 뷰로 전환(모달 재열림 없음, top-layer 1개 유지) → 뒤로 → 그리드 즉시
    복귀, 스크롤 위치·토글 상태 유지.
  - store /custom-order → 첨부 파일 추가 → 썸네일 클릭 → 확대 Modal → 닫기. 제거 버튼은
    여전히 제거만.
  - 리뷰 작성 모달 → 썸네일 클릭해도 아무 일 없음(확대 미지원 확인).
  - admin /products 폼 썸네일 클릭 확대.

## 실패 모드

- `previewable`을 모달 안 사용처에서 켜서 모달 위 모달이 생기는 것 — prop JSDoc 경고만으로는
  정적 차단이 없다. 리뷰어가 새 사용처의 컨텍스트(페이지인지 모달 안인지)를 확인해야 한다.
- 데스크톱 560px 캡이 "확대가 부족하다"로 돌아오는 것 — 그 신호가 오면 Modal `sizes`에
  large를 추가하는 것이 업그레이드 경로다(뷰어 신설·스왑 재론보다 먼저).

## 기각한 대안

- **스왑 패턴(완성본 모달 닫고 전용 뷰어 열기)** — 2026-08-20 검토로 기각: 이미지 한 번
  보는 데 top-layer 전환 3회 + 250ms 모션 왕복, overlay 상태 머신 확장과 신규 shared
  뷰어 컴포넌트가 필요하다. 뷰포트 전체 확대가 꼭 필요해지면(560px 캡 불만 + Modal
  large로도 부족) 재론.
- **모달 위 모달 금지에 뷰어 예외 추가(overlay.md 갱신)** — 2026-08-20 사용자 결정으로
  기각: 규칙은 예외 없이 유지한다.
- **새 탭에서 원본 열기(네이티브 `<a target="_blank">`)** — 가장 짧지만 모바일 커머스
  UX에서 맥락 이탈이 크고, iOS Safari의 blob: URL 새 탭 동작이 불안정.
- **신규 shared ImageViewer 컴포넌트** — 두 표면 모두 기존 프리미티브(인라인 전환·Modal)
  로 충분해 신설 근거(2개 앱 이상에서 필요한 새 패턴)가 사라졌다.
- **select variant(디자인 피커)에도 확대 추가** — 클릭=선택과 충돌, 확대 진입점을 따로
  만들면 카드가 복잡해진다. 피커에서 확대가 실제로 필요하다는 사용 신호가 생기면 재론.
- **실사화 완료 → 완성본 모달 자동 오픈 추가** — 이미 구현돼 있어 제외
  (`apps/store/src/pages/design/index.tsx:168`).
