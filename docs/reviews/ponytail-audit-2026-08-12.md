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
