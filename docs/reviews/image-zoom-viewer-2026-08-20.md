# 완성본·첨부 이미지 확대 보기 — 실행 기록 (2026-08-20)

`docs/plans/image-zoom-viewer.md`(제거됨)를 그대로 실행. "모달 위 모달 금지"(overlay.md)를
유지한 채, 신규 shared 오버레이 컴포넌트 없이 인라인 전환·기존 Modal 재사용으로 구현했다.
API·스키마·디자인 시스템 규칙 변경 없음.

## 변경 내역

- **완성본 모달 browse 카드 인라인 확대** — `apps/store/src/features/design/ui/finalized-gallery.tsx`
  - browse 카드 이미지를 버튼("완성본 N 크게 보기")으로 감싸 클릭 시 갤러리 콘텐츠를
    그리드 ↔ 단일 이미지 뷰(뒤로 + `ratio="auto"` 이미지 + 날짜)로 전환. top-layer는 1겹 유지.
  - 대상 URL은 현재 토글(tie→`tie_url`, fabric→`fabric_url`, 레거시 폴백 `result_url`) 그대로.
    URL이 전부 null인 레거시 행은 진입점 없음.
  - 포커스: 확대 진입 시 뒤로 버튼 autoFocus, 복귀 시 트리거 카드 버튼으로 복원(ref map).
  - select variant(디자인 피커)는 변경 없음 — 클릭=선택 유지.
- **`AttachmentDisplayField`에 opt-in 확대** — `packages/shared/src/components/attachment-display-field.tsx`
  - `previewable`(기본 false) prop. true면 썸네일을 버튼("○○ 확대")으로 감싸 기존 `Modal`
    (title 없이 `aria-label`)에 `ratio="auto"` 이미지 1장으로 표시. 제거 버튼(Float)은 버튼
    밖 형제라 중첩 없음. 확대 중 항목이 제거되면 Modal도 닫힘. src 빈 항목은 버튼 disabled.
  - 기본 false인 이유(JSDoc에 명시): 모달 안 사용처에서 켜면 모달 위 모달 위반.
- **`previewable` 활성 5곳(전부 페이지 컨텍스트 확인)** — store custom-order·sample-order·
  reform `tie-item-form`·`repair-photo-field`, admin `product-form`(대표·상세).
  리뷰 작성 모달의 `review-photo-field`는 계획대로 미지원.

## 검증

- `pnpm lint`(check-harness 포함)·`pnpm typecheck` 통과. 테스트: shared 68 · store 238 ·
  admin 237 전부 통과. 신규 테스트: 갤러리 확대 진입/복귀·레거시 무URL 진입점 없음,
  첨부 previewable 열림·미지정 시 버튼 없음.
- Aside 브라우저 실측(store :3002 임시 포트 — :3000을 타 프로젝트가 점유, api CORS에
  3002 임시 추가): 완성본 모달 확대 진입→뒤로→포커스 복원, custom-order 첨부 blob 이미지
  (400×300) 확대·Esc 닫기·삭제 버튼 분리, admin 상품 폼 확대 Modal. 콘솔 오류 0.
  시드 데이터의 만료된 서명 URL은 폴백 실루엣으로 표시(코드 무관, 기존 환경 문제).

## 남긴 결정

- 데스크톱 확대 상한은 Modal medium 560px — "확대 부족" 신호가 오면 Modal `sizes.large`
  추가가 다음 수순(플랜의 기각한 대안·실패 모드 그대로).
- 스왑 패턴·overlay.md 예외·신규 ImageViewer·새 탭 열기는 기각 — 사유는 플랜 원문 참조
  (top-layer 전환 3회 비용, 규칙 예외 없음(사용자 결정), 기존 프리미티브로 충분, 모바일 UX).
