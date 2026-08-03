# Recraft 모티프 관리자 승인 게이트 — 실행 리뷰

실행일: 2026-08-03  
원안: `docs/plans/motif-approval-gate.md` (실행 완료 후 제거)

Recraft로 새로 만든 모티프가 생성 즉시 전체 사용자 카탈로그에 전파되던 경로를 막았다.
행은 content-hash ID로 즉시 보존하되 `pending`으로 시작하고, 관리자 승인 뒤에만 검색·
grounding·variant 재사용·임베딩 집계·registry fingerprint에 들어간다. 생성 세션과 기존
세션의 ID 직접 조회는 상태와 무관하게 유지한다.

## 구현

- **DB**: `motifs.status(pending|approved|rejected)`, `reviewed_at`, `reviewed_by`를 모델과
  Alembic에 추가했다. 미배포 단일-baseline 정책에 따라 과거 행 백필 revision을 누적하지
  않고 새 baseline `f8c3b2a19d47`로 교체했다. 기존 개발 DB는 이어붙이지 않고 재생성·
  재시드해야 한다.
- **worker**: Recraft upsert 기본값은 `pending`, 신뢰된 seed는 `approved`다.
  `find_catalog`, `nearest_by_embedding`, `find_variant_pool`,
  `missing_embedding_documents`, `public_embedding_counts`, `all_motif_ids`는 승인된 공개
  행만 사용한다. `get_motifs`는 무필터로 남겼다. 승인 전 같은 spec 재요청이 Recraft를
  다시 호출할 수 있다는 비용 트레이드오프도 resolver 테스트와 문서에 고정했다.
- **API**: admin 목록에 상태 필터(기본 `pending`)와 검토 메타데이터를 추가하고,
  `POST /admin/motifs/{motif_id}/review`를 신설했다. admin만 승인·거절할 수 있고 row lock
  뒤 no-op은 409로 거부하며 승인 회수(`approved→rejected`)와 재승인을 허용한다.
- **admin UI**: 기존 목록·상세 화면에 상태 필터·badge·검토 시각과 확인 dialog 기반
  승인/거절 액션을 추가했다. manager는 읽기 전용이며 SVG는 기존 안전 프리뷰 경로를
  그대로 사용한다.
- **계약·문서**: OpenAPI client를 재생성하고 `ARCHITECTURE.md`, worker motif 명세,
  DB/operator 문서와 스테이징 체크리스트를 갱신했다. 남아 있던 `style_hint` 문구도 실제
  query-only 계약에 맞췄다.

## 검증

```text
uv run pytest                                      1190 passed (1 dependency warning)
uv run ruff check .                                통과
uv run ruff format --check .                       통과 (261 files)
uv run pyright                                     0 errors, 0 warnings
pnpm lint                                          537 files + check-harness 통과
pnpm turbo build typecheck test                    11/11 tasks 통과
pnpm codegen                                       163 paths 재생성 성공
uv run pytest tests/test_migrations.py             downgrade→upgrade→alembic check 통과
```

- `[E2E] 대상:admin Motif pending→approved→rejected 승인 게이트 | 이유:API 계약·DB
  스키마·admin 사용자 경로 변경 | 결과:PASS(1 흐름) | 실패:없음` — Aside 브라우저와
  격리된 임시 PostgreSQL/API/admin으로 pending 기본 목록, 안전 SVG 상세, 승인 후 approved
  필터 노출, 승인 회수 후 rejected 상태, 버튼 상태와 콘솔/page 오류 0을 확인했다. 임시
  환경은 제거했고 사용자가 실행 중이던 서비스와 기존 DB는 변경하지 않았다.

