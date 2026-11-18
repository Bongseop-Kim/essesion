# 스토어 하단 고정 바 safe area 적용 — 실행 기록 (2026-11-18)

플랜 `docs/plans/store-safe-area-bottom-bar.md`(삭제)를 실행했다. 아이폰 Chrome의 하단 툴바가 접힐 때
스토어 하단 고정 바(찜·장바구니·구매하기)가 홈 인디케이터 영역에 걸치던 문제를 고쳤다.

## 한 일

- **절차 1** — `apps/store/index.html`의 viewport 메타에 `viewport-fit=cover`를 넣었다. 이미 있던
  `env(safe-area-inset-bottom)` 네 군데(하단 바, 맨 위로 버튼, 디자인 편집 하단 패널, 스낵바)가 0이 아닌
  값을 받는다.
- **절차 3** — `packages/shared/src/components/snackbar.tsx`의 `bottom` 식을 `avoidBottom`과 inset 중 큰
  값 하나만 쓰게 바꿨다. `avoidBottom`은 하단 바 실측 높이라 inset을 이미 포함한다.
- **절차 2(좌우 safe area 패딩)** — 넣지 않았다. 가로 모드에서 내용이 노치에 가릴 때만 넣는 조건부
  항목이다.

## 검증

- `pnpm lint`, `pnpm typecheck` 통과.
- 운영자가 아이폰 실기기에서 "잘 된다"고 확인했다(2026-11-18). 플랜 검증 목록의 항목별 결과(Chrome·Safari
  각각, 가로 모드, `/design` 편집 화면, 스낵바)는 따로 받지 않았다.
- 플랜의 추정("cover를 넣으면 접힌 툴바 상태에서 inset이 채워진다")은 이 확인으로 맞는 것으로 본다.

## 후속

- 가로 모드에서 헤더 로고나 본문이 노치에 가리면 `packages/shared/src/components/layout.tsx`의 최상위
  `Box`에 `env(safe-area-inset-left)`·`env(safe-area-inset-right)` 패딩을 넣는다.
- 되돌릴 때는 메타에서 `viewport-fit=cover`만 지운다.
