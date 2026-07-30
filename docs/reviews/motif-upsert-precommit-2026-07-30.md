# 모티프 upsert 선커밋 — 실패 요청의 Recraft 비용 회수

실행일: 2026-07-30

상태: 구현·단위 검증 완료 (로컬 E2E 1건 잔여)

범위: `docs/plans/motif-upsert-precommit.md` 전체. 요청 실패 시 트랜잭션 롤백으로
과금된 Recraft 모티프가 사라지고 재시도가 재과금되던 문제를, 모티프 upsert만
전용 세션에서 즉시 커밋(선커밋)해 해결.

## 변경

- `apps/worker/src/worker/motifs/resolver.py` — `resolve_spec`·`resolve_motifs`에
  선택 인자 `upsert_sessionmaker` 추가. 값이 있으면 upsert 2곳(생성 직후 1차 +
  슬롯 라벨 2차)을 각각 전용 세션·독립 트랜잭션으로 즉시 커밋 — 라벨 2차 실패가
  1차 저장을 해치지 않는다. 없으면 현행 유지(요청 세션, 커밋은 호출자 소관)라
  시드 스크립트·`/motifs/generate` 경로는 무변경.
- `apps/worker/src/worker/api/routes.py` — `/generate`의 `resolve_motifs` 호출에만
  `upsert_sessionmaker=request.app.state.sessionmaker` 전달.
- `apps/worker/src/worker/config.py` — `db_max_overflow` 기본값 0→2. 선커밋 세션이
  요청 중 커넥션 1개를 짧게 더 쓰므로(기본 풀 2), 동시 생성 요청 시 풀 대기
  (기본 타임아웃 10초) 방지. 플랜 §5의 판단 항목을 상향으로 결정.

## 검증

- 신규 단위 `test_precommitted_upsert_survives_rollback_and_retry_skips_recraft`
  (testcontainers 실 Postgres): 해석 후 요청 세션 롤백에도 `source='recraft'`
  행이 남고, 같은 spec 재시도가 Recraft 0회로 exact 매치 재사용 — 플랜 검증
  체크박스 2건을 한 테스트로 커버.
- 회귀: `uv run pytest` 전체 1195 passed. ruff·pyright 통과.
- **잔여**: 로컬 E2E(실패 유도 후 같은 프롬프트 재실행 →
  `diagnostics.recraft_calls = 0`, admin 상세 "Recraft 호출 0회" 확인)는 실
  Recraft 과금·실패 주입이 필요해 수동 확인으로 남김. 회수 지표는 기존
  `diagnostics.recraft_calls` 대 신규 저장 모티프 수 대조로 충분(추가 지표 없음).

## 관찰

- 실패 요청의 모티프가 카탈로그에 남는 것은 의도된 자산화. 저품질 변형은 admin
  Motif SVG 화면에서 정리 가능하고 provenance(`ingested_user_id`/`ingested_session_id`)로
  추적된다. 정리 정책이 필요해지면 별도 플랜으로.
