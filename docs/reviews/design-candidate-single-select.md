# 디자인 후보 타게팅 단순화 — 실행 결과 (2026-07-29)

플랜: `docs/plans/design-candidate-single-select.md` (실행 완료로 제거). 미드저니 V1~V4의 핵심(타깃을 액션에 내장)만 가져와 "타일 클릭=조회 스테이징, 커밋은 별도 액션" 이중 상태를 **타일 클릭=선택 커밋** 단일 상태로 합쳤다. 서버 변경 없음.

## 변경 내역

- `apps/store/src/pages/design/index.tsx` — `viewedCandidate` 조회 스테이징·`selectFromViewed`·"이 이미지로 편집"(패널 버튼·타일 메뉴 항목) 삭제. 타일 클릭을 `selectCandidate`에 직결(낙관적 override + epoch 유지). 생성 중 타일 비활성(`candidateActionsDisabled`) — select의 409(generation_in_progress) 계약과 일치.
- `apps/store/src/features/design/ui/turn-feed.tsx` — `onViewCandidate` → `onSelectCandidate` 개명, 주석 재작성.
- `apps/store/src/features/design/ui/candidate-grid.tsx` — `[편집중]` 배지 제거, 선택 링만 유지.
- `apps/store/src/features/design/ui/composer.tsx` — 입력창 위 "이 디자인에 이어서" 칩(썸네일 24px, 표시 전용) 추가.
- 타일 앵커 메뉴의 다시만들기·실사화가 자동으로 탭한 후보 기준이 됨(탭=낙관적 select). intent가 select 응답으로 채워질 때까지 잠깐 비활성인 틈은 허용.
- `docs/plans/design-text-prompt-manual-test.md` — 판정 원칙 §1·C10·C11을 단일 상태 기준으로 재작성(클릭=정본 이동이 PASS).

## 검증

- store 테스트 238개·typecheck·빌드, 레포 lint(하네스 검사 포함) 통과. API design 테스트 72개 통과(변경 없음 확인).
- Aside 브라우저(localhost:3000/design, customer 계정): 변형 생성 → 자동 커밋이 최신 런 첫 후보로 이동, 과거 런 타일 클릭 → 링·컴포저 칩 즉시 이동 + 대화 유지, **새로고침 후에도 과거 후보 선택 복원**(서버 커밋 확정), `[편집중]`/"이 이미지로 편집" 부재, 콘솔 오류 0.
- 수동 테스트 지시서 전체 재검증은 미실행(기존 "수정 후 재검증 미실행" 사이클에서 갱신된 판정 원칙으로 수행 예정).
