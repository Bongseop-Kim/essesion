# 지시서: 온톨로지 + 시맨틱 레이어 (metrics-as-code) 도입

작성일: 2026-07-27 · 상태: 미실행 · 실행 완료 시 `docs/reviews/`에 결과 기록 후 본 파일 삭제

## 0. 한 줄 요약

admin 대시보드에 흩어진 지표 계산(`_revenue_order_filter`, KST 버킷팅, `ACTIVE_CLAIM_STATUSES`, ad-hoc 롤업)을 `apps/api/src/api/metrics/` 단일 Python 모듈로 중앙화하고, 엔티티 관계를 코드로 선언(ontology-as-code)하며, 이를 위해 필요한 최소 스키마 보강(`paid_at`, generation 타임스탬프, seamless 로그 FK 승격)을 Alembic 한 개 revision으로 처리한다. **별도 그래프 DB·외부 시맨틱 레이어 도구·DB 뷰는 도입하지 않는다.**

## 1. 현재 구현 분석

### 1.1 근거 — 지표 정의가 이미 갈라져 있다

- `apps/api/src/api/domains/admin/router.py:66,81`의 레거시 `GET /admin/stats/today|period`는 `Order.total_price`를 **상태 필터 없이** 합산한다. 반면 `GET /admin/dashboard/summary|timeseries`(구현: `apps/api/src/api/domains/admin/orders.py:377,437`)는 `_revenue_order_filter()`(`orders.py:82`)로 `대기중/결제중/취소`를 제외한다. 같은 "매출"이 엔드포인트마다 다른 값이다. (admin 프론트는 레거시 두 개를 호출하지 않음 — grep 확인.)
- 지표 조각이 여러 파일에 흩어져 있다: `NON_REVENUE_ORDER_STATUSES`·`MAX_TIMESERIES_DAYS`(`orders.py:74-79`), KST 일 버킷 `_kst_day`(`orders.py:432`)와 `kst_day_bounds`(`admin/helpers.py:11`), 활성 클레임 정의 `ACTIVE_CLAIM_STATUSES`(`domains/orders/status_machine.py:5` — 레포 유일의 "공유 지표 차원" 선례), 생성 통계 filtered-count 롤업(`admin/generation.py:465,925`).
- `docs/reviews/admin-uiux-audit-2026-07.md` "의도적으로 이연한 항목"이 생성 p50/p95·SLA 집계용 **읽기 모델**을 명시적으로 기다리고 있다 — 본 플랜의 메트릭 정의가 그 선행 조건이다.

### 1.2 아키텍처 제약 (설계를 결정짓는 것)

- `ARCHITECTURE.md` §4.2·§6.1: **DB 함수·트리거·애플리케이션 뷰 금지 — 규칙은 API 서비스와 테스트에 둔다.** 따라서 메트릭 정의는 SQL 뷰/dbt 스타일이 아니라 Python(SQLAlchemy expression)으로 간다.
- §8.3: seamless용 **별도 이벤트 테이블 금지** — 팩트/이벤트 스트림 접근은 배제.
- 프론트는 `packages/api-client`(OpenAPI 생성물)만 사용, api 스펙 변경 시 `pnpm codegen` 동일 커밋.
- 결제·토큰 과금 로직은 api에만 — 메트릭 평가도 api 프로세스 안에 둔다(worker는 소비하지 않음).

### 1.3 스키마 갭 (엔티티 체인이 끊긴 지점)

FK로 강제되는 체인: `users ─< orders ─< order_items ─> products`, `users ─< design_sessions ─< turns ─< attachments ─> motifs/images`, `users ─< generation_jobs ─> design_sessions(SET NULL)`, `users ─< design_tokens ─> orders(source_order_id)`, `claims(user_id, order_id, order_item_id)`.

끊긴 곳:

| 갭 | 현재 상태 | 본 플랜의 처리 |
|---|---|---|
| 결제 완료 시각 | `paid_at` 컬럼이 어디에도 없음. `order_status_logs` 전이로만 유도 가능 | **M1: `orders.paid_at` 추가 + 백필** (GMV·결제완료주문의 시간 기준) |
| `seamless_generation_logs` → user/session | `design_session_turns.payload->>'run_id'` 텍스트 매칭 + ±15분 휴리스틱 fallback(`admin/generation.py:855-862`) — 인덱스 없는 JSONB, 모델에서 가장 비싼 조인 | **M1: `session_id`/`user_id` FK(SET NULL) 승격 + 백필**, 휴리스틱 제거 |
| `generation_jobs` 소요 시간 | 시작/종료 타임스탬프 없음(`created_at`/`updated_at`뿐) | **M1: `started_at`/`finished_at` 추가** (finalize 시간·p50/p95) |
| `design_tokens` ↔ 생성 run | `work_id = "design_generate_{run_id.hex}"` 문자열 인코딩(`domains/design/router.py:1571`) | 마이그레이션 없이 **ontology soft-link resolver 한 곳**에서 파싱 |
| `token_purchases` ↔ `orders` | `payment_group_id` 양쪽 컬럼 존재, FK 없음 | soft link로 선언만 (지표에 조인 불요) |
| Design → Order | 링크 전무 — 디자인별 매출 귀속 불가 | **비목표** (§10) — 요청된 7개 지표에 불필요 |
| AI 금전 비용 | 비용 컬럼 없음. 토큰 소비량만 원장에 있고, 환산 단가는 `admin_settings` text 값(변경 시 과거 소급 재산정) | v1은 토큰 단위로 정의 + 환산은 파생 표시 (§3.7) |

### 1.4 기존 소비자

- `apps/admin/src/pages/dashboard.tsx` — `/admin/dashboard/*` 5종 + capabilities. 실패율 등 일부 파생값은 클라 계산(`:280-283,518-523`).
- `apps/admin/src/pages/generation/{jobs-list,seamless-list}.tsx` — `/admin/generation/{jobs,seamless}/stats`.
- 인가: `deps.py:106` `get_admin_user`(admin·manager). 인가 테스트는 `apps/api/tests/authz.py`의 `ADMIN_CASES` 레지스트리 + testcontainers(실 PG, mock 금지).

## 2. 목표 구조

```
apps/api/src/api/metrics/          # 신규 — 도메인 횡단이므로 domains/ 밖
  ontology.py     # 엔티티·관계 선언 (fk | soft) + soft-link resolver
  definitions.py  # MetricDef dataclass + 7개 지표 정의 + REGISTRY
  service.py      # 평가기: scalar(window) / timeseries(window, grain=KST day)
                  #   KST 버킷 헬퍼·0채움 루프를 orders.py에서 이동
apps/api/src/api/domains/admin/
  metrics_router.py   # GET /admin/metrics/definitions, GET /admin/metrics/values
  orders.py           # dashboard_* 내부를 REGISTRY 소비로 리팩터링 (계약 불변)
  generation.py       # stats 두 개도 REGISTRY 소비, ±15분 휴리스틱 삭제
```

원칙:

- **정의는 한 곳** — 대시보드 전용 shaped 엔드포인트(`/admin/dashboard/*`)는 유지하되 내부가 REGISTRY를 부르게 한다. 향후 AI 기능은 같은 `service.py`를 in-process로 부르거나 `/admin/metrics/values`를 부른다. 정의가 두 벌이 되는 순간을 테스트로 막는다(§7).
- **ontology는 문서가 아니라 검증되는 코드** — `ontology.py`의 fk 엣지는 테스트가 `Base.metadata` 실제 FK와 대조하고, soft 엣지는 resolver 함수(조인 expression)를 직접 들고 있어 사용처가 이 한 곳을 지난다.

```python
# definitions.py 형태 (개념 — 구현 시 조정 가능)
@dataclass(frozen=True)
class MetricDef:
    key: str                # "gmv"
    version: int            # 계산식·필터·시간 기준 변경 시에만 증가
    owner: str              # ARCHITECTURE §4.3 도메인 소유 기준: "commerce" | "design"
    description: str
    unit: str               # "krw" | "count" | "ratio" | "tokens_per_design" | "ms"
    time_basis: str         # 사람이 읽는 시간 기준 설명 (예: "orders.paid_at, KST 일 버킷")
    exclusions: tuple[str, ...]  # 사람이 읽는 제외 조건
    scalar: Callable[[Window], Select]
    timeseries: Callable[[Window], Select] | None  # 없으면 scalar만
```

`key + version`이 계약이다. 숫자 의미가 바뀌면 version을 올리고 골든 테스트를 갱신한다 — 조용한 재정의 금지.

## 3. 메트릭 정의 (v1 확정안)

공통: 시간대는 KST 일 버킷(`timezone('Asia/Seoul', col)`), 윈도우 상한 92일(`MAX_TIMESERIES_DAYS` 이동), 금액은 KRW int.

| # | key | owner | unit | 계산식 | 시간 기준 | 제외 조건 |
|---|---|---|---|---|---|---|
| 1 | `gmv` v1 | commerce | krw | `SUM(orders.total_price)` | `paid_at` | `order_type='token'`(토큰 지표와 이중계상), `paid_at IS NULL`. **결제 후 취소·환불은 차감하지 않음**(환불률에서 측정) |
| 2 | `paid_orders` v1 | commerce | count | `COUNT(orders)` | `paid_at` | gmv와 동일 스코프 |
| 3 | `refund_rate` v1 | commerce | ratio | `SUM((claims.refund_data->>'refund_amount')::int) / gmv(같은 윈도우)` | 클레임 완료 시각 = `claim_status_logs`의 첫 `'완료'` 전이 `created_at` | `claims.status != '완료'`, `type NOT IN ('cancel','return')`(exchange는 무환불, token_refund는 토큰 반환) |
| 4 | `generation_success_rate` v1 | design | ratio | `COUNT(status='succeeded') / COUNT(status IN ('succeeded','failed'))` on `generation_jobs` | `created_at` | `canceled`는 분모 제외(사용자 의사), 비종결(`queued/processing`) 제외 |
| 5 | `design_selection_rate` v1 | design | ratio | 후보 선택으로 이어진 run 수 / 성공 run 수, on `seamless_generation_logs` (M1 이후 `session_id` FK 조인) | 로그 `created_at` | 분모는 `status IN ('success','partial')`; "선택" 판정은 현행 `admin/generation.py:855-922`의 selected-candidate 로직을 `ontology.py` resolver로 이동해 단일화 |
| 6 | `ai_cost_per_selected_design` v1 | design | tokens_per_design | `SUM(-design_tokens.amount) WHERE type='use' AND work_id LIKE 'design_generate_%' / 선택된 디자인 수` | `design_tokens.created_at` | 환불된 소비(`type='refund'`) 상계 포함. **v1 단위는 토큰** — KRW 환산은 `pricing_constants` token 단가로 응답에 파생 필드 병기, 단가가 text 설정이라 소급 재산정되는 한계를 정의문에 명시 |
| 7 | `avg_finalize_time` v1 | design | ms | `AVG(finished_at - started_at)` on `generation_jobs WHERE kind='finalize' AND status='succeeded'` (M1 컬럼). p50/p95는 같은 정의에 `percentile_cont`만 교체 — 감사 이연 항목 해소 | `finished_at` | 실패·취소·비finalize 제외 |

주의 — 기존 대시보드와 숫자가 달라진다: 현행 "주문 금액"은 `created_at` 기준 + `대기중/결제중/취소` 제외였다. `gmv`는 `paid_at` 기준 + 결제 후 취소 포함이다. 대시보드 summary/timeseries의 주문 금액 시리즈를 `gmv` 정의로 통일하고, 변경 사실을 실행 결과 기록(`docs/reviews/`)에 명시한다.

구현 전 확정할 것(Phase 0): ① `total_price`에 배송비 포함 여부 — `docs/api-spec/money.md` 정본 대조, ② `refund_data->>'refund_amount'` 스키마 보장 — `domains/tokens/ledger.py:693` 사용례 대조, ③ 선택 이벤트 payload 어휘 — `admin/generation.py:855-922` 대조.

## 4. 데이터 모델 / 마이그레이션 (M1 — revision 1개)

`db/src/db/models/` 수정 + `uv run alembic -c db/alembic.ini revision --autogenerate` 후 백필 수동 추가. 규칙: CHECK 이름 필수, 새 enum·뷰·트리거 금지, 모델과 revision 같은 커밋, `alembic check` 통과.

1. `orders.paid_at TIMESTAMPTZ NULL` — 쓰기: 결제 confirm 성공 시점에 세팅(orders 도메인 confirm 경로). 백필: `order_status_logs`에서 결제중→진행중(또는 money.md가 정의하는 결제 확정 전이)의 첫 로그 `created_at`; 로그가 없는 행은 NULL 유지(지표에서 자연 제외).
2. `generation_jobs.started_at / finished_at TIMESTAMPTZ NULL` — 쓰기: worker 상태 전이 콜백 경로. 백필: 종결 상태 행에 한해 `updated_at`을 `finished_at`으로(근사치임을 revision docstring에 명시), `started_at`은 백필 없음.
3. `seamless_generation_logs.session_id UUID NULL FK design_sessions(id) ON DELETE SET NULL`, `user_id UUID NULL FK users(id) ON DELETE SET NULL` + 인덱스. 쓰기: 워커 기록 경로(`apps/worker/src/worker/api/routes.py:225`)에 api가 run 생성 시 이미 아는 session/user를 전달(워커 HTTP 계약 필드 추가). 백필: 현행 `payload->>'run_id'` 매칭 쿼리를 일회 실행해 채움; 미매칭 행은 NULL 허용.

참고: 컷오버 전(체크리스트 §2 미적용)이면 `ARCHITECTURE.md` §6.4에 따라 베이스라인 `dadd999bf858`에 컬럼을 합치고 로컬 drop/recreate+시드도 허용된다. 다만 백필 로직 보존을 위해 **별도 revision을 기본 경로로 권장** — 스테이징 적용 시점과 무관하게 안전하다.

## 5. API 변경 (codegen 동반)

| 변경 | 내용 |
|---|---|
| 신규 `GET /admin/metrics/definitions` | REGISTRY 메타데이터 전체: `{key, version, owner, description, unit, time_basis, exclusions, formula_text}`. 향후 AI 기능의 grounding 소스 |
| 신규 `GET /admin/metrics/values?keys=&from=&to=&grain=day\|total` | 요청 키들의 평가 결과 `[{key, version, window, value \| points[]}]`. 92일 가드 공유 |
| 삭제 `GET /admin/stats/today`, `/admin/stats/period` | admin 프론트 미사용 확인됨. `authz.py`의 `admin_stats_today` 케이스 제거 |
| 계약 불변 | `/admin/dashboard/*` 5종, `/admin/generation/*/stats` 2종 — 내부만 REGISTRY 소비로 교체. 단 timeseries의 주문 금액 시리즈 **값**은 gmv 정의로 바뀜(§3 주의) |
| worker HTTP 계약 | seamless 로그 기록 요청에 `session_id`/`user_id` 필드 추가 (api→worker 방향, OIDC 경로 불변) |

절차: 스펙 변경 커밋에 `pnpm codegen` 생성물 포함(CI `codegen-drift`), 신규 엔드포인트를 `apps/api/tests/authz.py` `ADMIN_CASES`에 등록, 이 기회에 누락된 `/admin/dashboard/*`도 레지스트리로 이관(현행 ad-hoc 403 스윕 대체).

## 6. 단계별 작업과 변경 파일

**Phase 0 — 정의 확정 (반나절)**
§3의 확정 사항 3건 대조. 산출물: 본 문서 §3 표의 공란 없는 확정본.

**Phase 1 — 스키마 (M1)**
- `db/src/db/models/{commerce,design,seamless}.py` — 컬럼 3세트
- `db/migrations/versions/2026MMDD_<rev>_metrics_columns.py` — DDL + 백필
- `apps/api/src/api/domains/orders/…`(confirm 경로) — `paid_at` 세팅
- `apps/worker/src/worker/api/routes.py` + api 쪽 워커 클라이언트(`api/integrations/worker.py`) — session/user 전달, job 타임스탬프 기록
- `tests/test_migrations.py` 통과 확인 (루트 `tests/` — `db/` 밑에 테스트 금지)

**Phase 2 — metrics 패키지**
- 신규 `apps/api/src/api/metrics/{ontology,definitions,service}.py`
- 이동·흡수: `orders.py`의 `_revenue_order_filter`·`_kst_day`·`by_day`·0채움·`MAX_TIMESERIES_DAYS`, `helpers.py`의 `kst_day_bounds`, `status_machine.py`의 `ACTIVE_CLAIM_STATUSES`는 원위치 유지하되 `definitions.py`가 import(정의 원본은 상태기계 쪽이 맞음)
- `admin/orders.py`·`admin/generation.py` 리팩터링: REGISTRY 소비, ±15분 휴리스틱(`generation.py:855-862`)과 run_id JSONB 조인 삭제 → 승격 컬럼 사용

**Phase 3 — API 표면**
- 신규 `apps/api/src/api/domains/admin/metrics_router.py` + `main.py` 마운트
- `admin/router.py` 레거시 stats 2종 삭제
- `pnpm codegen` → `packages/api-client` 생성물 동일 커밋
- `apps/api/tests/authz.py` 케이스 갱신

**Phase 4 — admin 대시보드 정렬**
- `apps/admin/src/pages/dashboard.tsx` — 재생성된 클라이언트 반영(계약 불변이라 대부분 무변경), 메트릭 카드에 정의 툴팁(설명·버전 — `definitions` 응답 사용, 선택 사항)
- 클라 파생값(실패율 툴팁 등)은 서버 필드 두 개의 표시 연산이므로 유지

**Phase 5 — 테스트·문서 (§7)** 후 `docs/reviews/`에 결과 기록, 본 파일 삭제.

## 7. 테스트 (전부 testcontainers 실 PG, mock 금지)

| 종류 | 내용 | 위치 |
|---|---|---|
| 메트릭 골든 회귀 | 지표별로 경계 데이터를 factories로 심고 기대값 고정: 미결제/결제 후 취소/token 주문(gmv), exchange·token_refund 클레임(refund_rate), canceled job(분모 제외), 미선택 run(선택률), refund 상계(AI 비용), 실패 finalize(시간). version 필드를 테스트가 pin — 정의 변경 시 테스트와 version이 함께 움직이도록 | `apps/api/tests/test_metrics_definitions.py` |
| 정의 단일성(등가) | `/admin/dashboard/summary·timeseries` 응답 == 같은 윈도우 REGISTRY 평가값. 재분기 방지의 핵심 | `apps/api/tests/test_metrics_equivalence.py` |
| 온톨로지 정합 | `ontology.py`의 fk 엣지가 `Base.metadata` 실제 FK에 존재; soft-link resolver 왕복(work_id 파싱, payment_group_id 조인) | `apps/api/tests/test_ontology.py` |
| 인가 | 신규 2 엔드포인트 `ADMIN_CASES` 등록, customer 403 | `apps/api/tests/authz.py` |
| 성능 | 신규 컬럼 인덱스 사용을 기존 패턴대로 검증(`test_admin_query_plans.py`에 케이스 추가 — seamless `session_id`, orders `paid_at`) | `apps/api/tests/test_admin_query_plans.py` |
| 백필 | 마이그레이션 백필 정확성: status log 있는/없는 주문, run_id 매칭/미매칭 로그 | `tests/test_migrations.py` 또는 인접 신규 파일 |
| 기존 회귀 | `test_admin_orders.py`(§3 주의의 값 변경 반영해 기대값 갱신), `test_admin_generation.py`, `dashboard.test.tsx` | 기존 파일 |

CI: `pnpm lint`, `pnpm turbo build typecheck test`, `uv run pytest`, `ruff`, `pyright`, codegen-drift, contract(schemathesis가 신규 엔드포인트 자동 커버) 전부 green.

## 8. 완료 기준

1. 7개 지표가 REGISTRY에 `key/version/owner/계산식/시간 기준/제외 조건/unit` 전 필드로 존재하고 `/admin/metrics/definitions`가 노출한다.
2. admin 대시보드와 `/admin/metrics/values`가 같은 윈도우에 같은 숫자를 내며, 등가 테스트가 이를 강제한다.
3. 매출 정의 불일치(레거시 stats)가 제거됐다 — "매출"의 의미가 레포에 하나다.
4. ±15분 requester 휴리스틱과 JSONB run_id 조인이 사라지고 FK 조인으로 대체됐다.
5. M1 revision이 `alembic check`·마이그레이션 테스트를 통과하고 모델과 같은 커밋에 있다.
6. api-client 재생성물이 스펙 변경 커밋에 포함, CI 전 job green.
7. 감사 이연 항목 중 "생성 p50/p95" 산출이 가능해졌다(정의 존재 — 화면 노출은 별도 작업).

## 9. 위험

| 위험 | 대응 |
|---|---|
| 대시보드 숫자 변경(시간 기준 created_at→paid_at, 취소 처리 변경) | §3에 델타 명시, 골든 테스트로 새 기대값 고정, reviews 기록에 변경 전후 정의 병기 |
| `paid_at` 백필 부정확(로그 없는 구주문) | NULL 유지 → 지표에서 제외됨을 정의문에 명시. 스테이징/프로덕션은 아직 빈 DB(컷오버 전)라 실위험 낮음 |
| run_id 백필 미매칭 잔여 행 | NULL 허용, 선택률 분모는 로그 기준이라 영향 없음. 미매칭 건수를 백필 revision이 로그로 남김 |
| 토큰 단가(admin_settings text) 변경 시 과거 AI 비용 소급 재산정 | v1은 토큰 단위가 정본, KRW는 파생 표기. 재무 정확도가 요구되면 과금 시점 단가 스냅샷 컬럼을 **별도 플랜**으로 |
| 쿼리 타임 집계의 성능 상한 | 현 규모(단일 PG, 92일 가드)에서 충분. 커지면 감사가 말한 사전 집계 읽기 모델을 REGISTRY 정의 위에 얹는 별도 플랜 — 정의가 중앙화돼 있어야 그때 이식이 싸다 |
| worker HTTP 계약 변경 | 필드 추가는 하위 호환(optional), 로컬은 OIDC 없이 검증 가능 |

## 10. 비목표

- **Neo4j 등 그래프 DB** — 관계는 FK + `ontology.py` 선언으로 충분. 가변 깊이 그래프 탐색이 실제 기능 요구로 등장할 때만 재검토.
- **dbt·Cube·MetricFlow 등 외부 시맨틱 레이어** — 단일 Postgres + FastAPI 규모에 인프라 과잉이고, materialization 계열은 "DB 뷰·트리거 금지" 원칙과 충돌.
- **이벤트/팩트 테이블, materialized view** — `ARCHITECTURE.md` §6.1·§8.3 명시 금지.
- **Design → Order FK(디자인 귀속 매출)** — 요청된 7개 지표에 불필요한 구조 변경. 필요성이 생기면 별도 플랜.
- **store 노출 지표, GA4 서버 연동, 실시간 스트리밍, 지표 알림** — 범위 밖.
