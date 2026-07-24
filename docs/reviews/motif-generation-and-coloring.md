# 모티프 생성·의미 기반 색 배분 실행 리뷰

실행일: 2026-07-24  
원 지시서: `docs/plans/motif-generation-and-coloring.md` (완료 후 제거)

## 결과

- Plan v3에 catalog-empty 전용 `generate` motif source를 추가했다. 구체적 개별 도형을 명시한 텍스트만 원문 기반 semantic spec으로 컴파일하고, 색·무드·질감만 있는 요청은 모티프를 발명하지 않는다.
- 같은 요청의 모든 authored design과 적합성 재시도가 실제 Recraft 호출 기본 2회 상한을 공유한다. 초과 best-effort layer와 generate-origin injection 의심 facet은 경고와 함께 drop하며 나머지 구조는 계속 생성한다.
- 신규 Recraft content-hash 행에만 최초 사용자·디자인 세션 provenance를 기록한다. catalog hit는 덮지 않고 사용자·세션 삭제 시 FK가 `SET NULL`된다.
- 멀티슬롯 원색 보존을 기본값으로 바꿨다. `color_indices` 명시는 의미 라벨 rank 재색, 생략은 non-fixed palette의 원색 보존 신호이며 fixed palette는 compiler가 명시를 강제한다.
- 단일슬롯은 실제 ground HEX와 다른 다음 팔레트 색을 전순서에서 찾고, 축퇴 팔레트에서는 기존 선택을 유지한다. 라벨이 없는 레거시는 DFS 위치+모듈로 배정을 그대로 사용한다.
- 신규 멀티슬롯 유입에만 비전 라벨링을 한 번 실행한다. 실패는 NULL로 fail-soft하고 catalog hit에서는 호출하지 않는다. 공개 NULL 행용 멱등 백필 스크립트 `backfill_slot_labels.py --confirm-live`를 추가했다.
- `motifs.slot_labels`, `ingested_user_id`, `ingested_session_id`를 Alembic revision `a7c41e2b9d60`으로 추가했다. 라벨·원색·provenance는 content-hash identity에 포함하지 않는다.

## 검증

- `uv run pytest -q` — 905 passed, subtests 186 passed
- `uv run ruff check .` — 통과
- `uv run pyright` — 0 errors
- `pnpm turbo build typecheck test` — 11 tasks 통과, Vitest 510 passed
- 추적 파일 기준 Biome 523개 및 `check-harness.mjs` — 통과
- `pnpm codegen` — 통과, 공개 OpenAPI/api-client drift 없음
- Alembic upgrade → legacy NULL 확인 → downgrade → re-upgrade → model drift check — 전체 테스트에서 통과

`pnpm lint`의 원형 명령은 Git에서 무시되는 개인 파일 `.claude/settings.local.json`의 기존 포맷 차이로 중단됐다. 해당 파일은 수정하지 않았고, 같은 Biome 검사를 Git 추적 파일 전체에 적용한 뒤 harness를 별도로 통과시켰다.

## 남은 운영 작업

코드 작업은 완료했다. 스테이징/프로덕션의 실제 `backfill_slot_labels.py --confirm-live` 실행과 `eligible/updated` 기록 확인은 클라우드 개통 뒤 운영 게이트이므로 `docs/CHECKLIST.md`에서 미완료 상태로 유지했다.
