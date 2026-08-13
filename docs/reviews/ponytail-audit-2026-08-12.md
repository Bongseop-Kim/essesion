# 과설계 감사 적용

2026-08-12 `ponytail-audit` 결과 중 실제 순감축이 확인된 항목을 적용했다.

- 기존 lint·typecheck·test 위에 있던 GC runner, normalizer, baseline, 주간 workflow를 제거했다.
- 문서 링크, 모듈 루트, TypeScript/Python 의존 방향의 확정적 architecture gate는 유지했다.
- admin 목록 필터 패널의 중복 초기화 callback과 payment incident 기록 중복을 공통화했다.
- Accordion의 실제 사용 API를 유지하면서 disclosure 상태와 접근성은 네이티브 `details`/`summary`에 맡겼다.
- responsive style engine과 `Float`는 디자인 시스템의 광범위한 정본이라 순감축이 아니어서 유지했다.

## 검증

- `pnpm lint`, `pnpm architecture:check`, `uv run ruff check .`, `uv run pyright` 통과
- shared 65개, store 216개, payment 28개 테스트 통과
- admin 변경 관련 48개와 전체 실행에서 실패한 15개를 파일 단위로 재실행해 통과
- admin 전체 병렬 실행은 기존 테스트 격리 문제로 실패했다. 단독 통과하는 테스트가 전체 실행에서 타임아웃과 이전 DOM 잔존으로 실패한다.
- store 결제 E2E는 결제 confirm 전에 세션 bootstrap이 풀려 로그인 dialog가 노출되어 실패했다. payment incident 변경 경로에는 도달하지 않았다.

## 후속 단순화 (2026-08-13)

- 제품 로드맵에 있는 네이버·Apple 로그인 구현은 그대로 유지했다.
- store의 feature/entity 배럴 18개를 제거하고 실제 모듈을 직접 import하도록 바꿨다.
- 단일 사용이던 Avatar와 PageBanner를 호출부의 기본 컴포넌트 조합으로 대체했다.
- 미배포 design turn의 `kind: "photo"` 호환 분기와 전용 테스트를 제거했다.
- Turborepo를 제거하고 root·CI·배포 명령을 pnpm workspace 재귀 실행으로 통일했다.

검증은 `pnpm lint`, `pnpm architecture:check`, `pnpm typecheck`, 공개 로컬 환경값을 둔
`pnpm build`, store 216개·shared 65개 테스트, design 문맥 통합 테스트, Ruff, Pyright를
통과했다.

## 추가 감사 적용 (2026-08-13)

- 네이버·Apple 로그인 구현과 계약은 변경하지 않았다.
- shared 폼·스크롤·AlertDialog·Divider의 실제로 쓰이지 않는 옵션을 제거했다.
- 단일 사용 Breadcrumb·Footer·PaymentActionBar와 로그아웃 훅을 실제 사용처에 합쳤다.
- worker의 미사용 preview concurrency 설정과 엄격 스키마 검사를 반복하던 테스트 4개를 제거했다.
- `.turbo`, `scratch`, `playwright-report`, `test-results` 345MB를 복구 가능한 휴지통 폴더로 이동했다.

전체 변경은 270줄 순감축했다. `pnpm lint`,
`pnpm architecture:check`, `pnpm typecheck`, 공개 로컬 환경값을 둔 `pnpm build`, Ruff,
Pyright를 통과했다. shared 65개, store 216개, 수정한 worker 영역 99개 테스트와 store 결제
E2E 1건도 통과했다.

## 전체 감사 마무리 (2026-08-13)

- 커스텀 날짜 달력과 숫자 스테퍼를 네이티브 `date`·`number` 입력으로 대체했다.
- 모바일 시트/중앙 모달 구현을 반응형 `Modal` 하나로 합치고 `ResponsiveModal`, `BottomSheet`, 드래그 훅을 제거했다.
- 메뉴와 도움말의 좌표 계산·resize/scroll 구독을 네이티브 Popover와 CSS anchor positioning으로 대체했다.
- store 세션에서 Zustand를 제거하고 React `useSyncExternalStore` 기반의 작은 외부 저장소만 남겼다.
- 단일 구현뿐이던 admin session adapter를 직접 함수 경계로 바꿨다.
- 사용되지 않은 GCS 공개 URL override와 CI 진단용 JSON/hash 포맷을 제거했다.

58개 파일에서 317줄을 추가하고 1,554줄을 삭제해 1,237줄 순감축했다. `pnpm lint`,
`pnpm typecheck`, 공개 로컬 환경값을 둔 `pnpm build`, `pnpm architecture:check`, 수정한
Python 파일의 Ruff·Pyright를 통과했다. shared/admin/store 대상 테스트 27개와 API 대상 테스트
4개도 통과했다. 사용자 여정이나 API 계약은 바뀌지 않아 브라우저 E2E는 생략했다.
