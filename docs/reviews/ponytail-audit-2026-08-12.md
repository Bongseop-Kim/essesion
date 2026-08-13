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
