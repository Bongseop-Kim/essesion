# 지표 스키마 갭 보강 + 레거시 매출 정의 제거 — 2026-07-27

`docs/plans/metrics-schema-gaps.md` 실행 결과. 플랜 파일은 삭제했다.

## 결론

admin 지표가 옳은 값을 내지 못하게 막고 있던 세 가지 갭을 컬럼 3세트로 메우고,
"매출"의 정의를 하나로 통일했다. 메트릭 레지스트리·시맨틱 레이어·온톨로지 선언
레이어는 만들지 않았다(소비자가 admin 대시보드 하나뿐이고, 정의 분기 자체가
사라졌다). 컷오버 전이므로 컬럼은 베이스라인 revision에 직접 합쳤고 백필·구 데이터
호환 경로는 없다.

## 스키마 (베이스라인 `dadd999bf858` 직접 수정, 추가 revision·백필 없음)

| 컬럼 | 의미 | 쓰기 지점 |
|---|---|---|
| `orders.paid_at TIMESTAMPTZ NULL` + `ix_orders_paid_at` | 결제 승인 확정 시각. NULL = 미결제 | `payments/service.py::_apply_confirmation` — confirm·웹훅 대사 공용 단일 지점 |
| `generation_jobs.started_at / finished_at TIMESTAMPTZ NULL` | 상태 전이 실측 시각. NULL = 미도달 | worker `→processing` / `_finish_job`, api `_fail_finalize_dispatch`·`cancel_generation_job`·`resolve_stale_finalize_jobs` |
| `seamless_generation_logs.session_id / user_id UUID NULL FK ON DELETE SET NULL` + 각 인덱스 | 요청자 링크 | worker의 성공·실패 로그 양쪽 경로에서 `motif_provenance.{user_id, session_id}`로 채움 |

- 워커 HTTP 계약은 변경 없음 — `GenerateRequest.motif_provenance`가 이미 두 값을 싣고
  api가 항상 채운다. NULL 허용 사유는 탈퇴·세션 삭제 시 SET NULL(`motifs.ingested_user_id`와 동일 근거).
- FK 2개는 `users`·`design_sessions`가 나중에 생성되므로 `motifs`와 같은 방식으로
  `op.create_foreign_key`로 분리했고, downgrade에서도 두 테이블 drop보다 먼저 떨군다.
- 검증: 빈 DB에서 `upgrade head` → `alembic check` "No new upgrade operations detected"
  → `downgrade base` 전부 통과. `tests/test_migrations.py` 통과.

## 매출 정의 변경 (전 → 후)

| | 변경 전 | 변경 후 |
|---|---|---|
| 시간 기준 | `Order.created_at` (주문서 생성) | `Order.paid_at` (결제 확정) |
| 미결제 배제 | `status NOT IN ('대기중','결제중','취소')` | `paid_at` 윈도우가 NULL을 자동 배제 |
| 결제 후 취소 | 매출에서 제외 | **매출에 포함** — 차감하지 않고 클레임 지표에서 본다 |
| 엔드포인트 | `/admin/stats/*`(상태 필터 없음)와 `/admin/dashboard/*`(상태 필터 있음) 두 벌 | `/admin/dashboard/*` 한 벌 |

적용 대상: `dashboard_summary`, `dashboard_timeseries`의 주문 시리즈,
`dashboard_top_products`. `_revenue_order_filter()`와 `NON_REVENUE_ORDER_STATUSES`는
이동이 아니라 삭제했다 — 상태 기반 매출 정의가 레포에 남지 않는다.

## 삭제한 것

- `GET /admin/stats/today`, `GET /admin/stats/period` + `StatsResponse`,
  `_apply_type_filter`, `admin/router.py`의 중복 `KST` 상수(`helpers.py`와 겹쳤음).
  admin 프론트는 두 엔드포인트를 호출하지 않았다.
- `admin/generation.py`의 `request_id` + ±15분 시간창 fallback. 세션/유저는 새 FK에서
  직접 읽고, 턴 상관은 **세션 스코프 안의 `payload->>'run_id'` 등가 매칭만** 남겼다.
  인덱스 없는 전역 JSONB 조인이 사라졌다.
- 테스트: `authz.py`의 `admin_stats_today` 케이스, `test_admin_domain.py`의 stats 블록.

## 새로 만든 것

- `admin/generation.py::finalize_duration_seconds()` — 성공 finalize의
  `percentile_cont(finished_at - started_at)` avg/p50/p95(초). **화면 노출은 별도 작업**.
  `docs/reviews/admin-uiux-audit-2026-07.md`가 이연한 "생성 p50/p95"의 선행 조건이 이로써 해소됐다.

## 부수 변경

`apps/api/scripts/seed.py`가 심는 결제 완료 주문(`진행중`·`수선중`)에 `paid_at`을
채웠다. 없으면 로컬 admin 대시보드 매출이 0으로 보인다.

## 테스트

- `test_admin_orders.py` — created_at은 기간 밖/paid_at은 기간 안(및 그 역)인 주문으로
  시간 기준 전환을 방어. 미결제(`paid_at IS NULL`) 제외, 결제 후 취소 포함을 단언.
- `test_admin_generation.py` — FK로 채운 로그의 세션/유저 노출, 상관 턴이 없는 실패
  로그도 요청자를 드러냄, 휴리스틱 제거 후 선택 판정 동일. `finalize_duration_seconds` 분포.
- `test_payments.py` — confirm 성공 후 그룹 전체 주문에 `paid_at`이 있는지 단언
  (누락 시 매출이 0으로 보이는 위험 방어).
- `test_admin_query_plans.py` — `ix_orders_paid_at` 범위 스캔, `ix_seamless_generation_logs_session_id` 조회.
- CI 전체 green: `uv run pytest` 1125 passed, `ruff`, `pyright`, `pnpm lint`,
  `pnpm turbo build typecheck test` 11/11, codegen 재실행 무변화.

## 운영 메모

베이스라인을 수정했으므로 **로컬 DB는 drop/recreate가 필요하다**(`ARCHITECTURE.md` §6.4).
스테이징·프로덕션은 빈 DB라 영향 없다.

```
docker compose down -v && docker compose up -d
uv run alembic -c db/alembic.ini upgrade head
uv run python apps/api/scripts/seed.py
```
