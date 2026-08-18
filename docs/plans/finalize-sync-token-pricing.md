# 실사화(finalize) 개편 — 동기 전환 · 프리뷰 통합 · 소액 토큰 과금

**배경**: finalize는 외부 AI 호출이 없는 결정론적 CPU 렌더다(`apps/worker/src/worker/render/fabric.py`,
회당 인프라 원가 2.4~4.8원 추정). 그런데 현재 구조는 장시간 배치용 풀세트를 쓰고 있다 —
Cloud Tasks 잡 큐(910s deadline) + 2.5초 폴링 + 75분 TTL lazy 취소 + "끝나면 알려드릴게요"
스낵바 + 계정당 24시간 10회 쿼터. 정작 LLM을 부르는 `/design/generate`는 동기다.
결과물은 넥타이/타일 프리뷰와 단절돼 평면 이미지로만 보인다.

**목표** (서로 독립인 세 축, 순서대로 실행):

1. **동기 전환** — generate와 같은 요청-응답 경로로. 잡 큐·폴링·취소·TTL 기계 삭제.
2. **쿼터 → 소액 토큰 과금** — `design_finalize_daily_limit`(10회/일) 폐기,
   `design_finalize_cost`(기본 5토큰) 신설. 남용 방어는 토큰 유한성이 대체한다.
3. **프리뷰 통합** — 실사화 PNG를 기존 넥타이/타일 뷰에 배선.

관련: `docs/api-spec/worker-pipeline.md §4·§5`, `docs/api-spec/money.md §6`,
`docs/plans/token-pricing-recalibration.md`(실사화 3~5토큰 표현 가능 언급),
`docs/reviews/design-input-modality-e2e-2026-07-30.md`(U23·C5).

## 0. 실측 게이트 (§1 전에 반드시)

`apps/api/src/api/domains/admin/generation.py::finalize_duration_seconds()`(집계만 있고 미노출)로
성공 job의 avg/p50/p95를 확인한다. 프로덕션 표본이 없으면 로컬에서 최악 케이스
(**선염 + 모티프 포함 intent, 300 DPI** — compose+rasterize 3~4회, `fabric.py:1-26`)를 수동 벤치.

- **p95 ≤ 30초** → §1 진행.
- 넘으면 §1은 보류하고 §2·§3만 진행한다. 이때 §2는 async 위에 얹어야 하므로 부록 A를 따른다.

## 1. 동기 전환

`/design/generate`(`router.py:999-1078`)와 같은 모양으로 맞춘다. **GenerationJob 행은
유지하되 "완성본 레코드"로 의미를 축소한다** — 완성본 보관함(`GET /design/jobs`)·
order-reference·삭제가 전부 이 행을 키로 쓰므로 테이블은 남고, `queued`/`processing`
상태와 그 주변 기계만 사라진다.

### worker

- `/tasks/finalize`(`apps/worker/src/worker/api/routes.py:1139`)의 render+GCS 업로드 본체를
  추출해 **stateless 동기 엔드포인트 `POST /api/v1/finalize`** 로 노출한다 — `/export`(`routes.py:1114`)와
  같은 급. DB claim·FOR UPDATE·lease(`finalize_lease_seconds`) 없음. 입력은 현재
  `job.params`와 동일 형태, 출력은 현재 `job.result`와 동일 필드(+object_key). 업로드 키
  `fabric/{sha256[:16]}.png` content-addressed 계약은 그대로.
- 영구 실패(`FabricError`/`IntentInvalid`/`RasterLimitError`)는 4xx + 기존 공개 에러 코드
  (`FINALIZE_INVALID_INPUT`), 일시 실패는 5xx — api가 UpstreamError로 변환.
- `/tasks/finalize` 라우트와 `_finish_job`의 finalize 분기 삭제.

### api

`create_finalize_job`(`router.py:1866-1989`)을 재작성:

1. provenance 검증(run_id·intent 일치)은 **그대로 유지** — `router.py:1893-1942`.
2. `acquire_finalize_quota` 호출을 §2의 토큰 차지로 교체.
3. worker를 동기 호출(`_shielded()` 래핑 — 클라 끊겨도 완주, generate와 동일 `router.py:1067-1078`).
4. 성공 시 `GenerationJob(status="succeeded", result=..., finished_at=...)` **한 번에 INSERT** 후
   `GenerationJobOut` 반환(응답 스키마 유지 → 프론트 타입 재사용). 실패 시 행을 남기지 않고
   환불 + 에러 응답 — 보관함에는 성공만 존재한다.

**삭제 목록**:

- `POST /design/jobs/{id}/cancel`(`router.py:2070`) — store에서 부르는 코드가 원래 없음(죽은 경로).
- `GET /design/jobs/{id}`의 lazy stale 취소 블록(`router.py:2046-2066`). 단건 GET 자체는
  order-reference 플로우가 쓰는지 확인 후, 폴링 용도뿐이면 함께 삭제.
- `_fail_finalize_dispatch`와 ambiguous-enqueue 판별(`router.py:1974-2011`).
- `job_lifecycle.py`의 stale finalize 회수 기계(`STALE_GENERATION_JOB_AFTER`,
  `stale_finalize_clause`, `resolve_stale_finalize_jobs`) — 단, generate 쪽
  `_recover_stale_active_generation`이 같은 상수를 쓰면 그 용도는 남긴다.
- `tasks.py`의 `enqueue_finalize`·finalize 큐(`apps/api/src/api/integrations/tasks.py:57-106`).
  InlineTaskQueue가 finalize 전용이었다면 통째로. infra의 Cloud Tasks finalize 큐 정리는
  `infra/README.md` 절차에 추가.

**타임아웃 정합**: api→worker 호출 타임아웃과 api Cloud Run request timeout이
§0 실측 p99를 덮는지 확인한다(generate가 이미 60초급 동기 호출을 하므로 기준선은 있음).
worker-finalize 서비스(2vCPU/4Gi, 동시성 1~2)는 유지하되 dispatchDeadline 910s 관련
설정은 일반 request timeout으로 대체.

### store

- `model/use-finalize-job.ts` **삭제** (폴링 전부).
- `model/use-design-output.ts`의 finalize 스낵바 2종("시작했어요…끝나면 알려드릴게요" /
  "끝났어요")과 jobId 로컬 state 삭제 → 제출 중 busy 처리(generate와 동일), 응답 즉시 결과 표시(§3).
- `finalize-dialog.tsx`는 제출 → 응답까지 pending 상태만 표시. 페이지 이탈 마커
  (generate의 `model/pending.ts` 같은 것)는 만들지 않는다 — 성공 결과가 보관함에 남으므로 불필요.

## 2. 쿼터 → 소액 토큰 과금

### 단가

- 새 admin_settings 키 **`design_finalize_cost` = `"5"`** (`config_defaults.py:17-25`에 추가,
  `design_finalize_daily_limit` 제거). 근거: 원가 2.4~4.8원, money.md §6의 "최악 원가 <
  단가" 가드를 최소로 충족하는 값. 1토큰≈1원 스케일 유지. 재조정은
  `token-pricing-recalibration.md` 실측 때 함께.
- `config_defaults.py`에 admin_settings용 retired 키 삭제를 추가한다(현재
  `_RETIRED_PRICING_KEYS`는 PricingConstant만 지움) — `design_finalize_daily_limit` 행이
  운영 DB에 유령으로 남지 않게.

### api

- `create_finalize_job`에서 generate의 차지 패턴(`_start_generation`, `router.py:1344-1406`)을
  따른다: `advisory_xact_lock(USER_LOCK)` → `ledger.use_tokens(work_id=f"design_finalize_{job_id.hex}")`
  (job_id는 INSERT 전에 `uuid4()`로 확정해 행 id로도 사용 — work_id 멱등의 축).
  실패 시 같은 work_id로 `ledger.refund_failed_generation` — 동기라 환불 지점은
  요청 안 한 곳뿐이다.
- `quota.py` **파일 삭제**. `finalize_quota_exhausted`·`missing_configuration`(finalize 한도)
  에러 코드 삭제. 토큰 부족은 generate와 같은 `insufficient_tokens`/`refund_pending` 경로.
- 세션 단건 GET의 `finalize_quota` 필드(`router.py:844-848`) 삭제 — **api-client breaking**,
  `pnpm codegen` 필수.

### admin / store

- `apps/admin/src/pages/settings.tsx:62-73`의 "실사화 24시간 한도" 항목을
  "실사화 토큰 단가"(기본 5, 다른 단가 키와 같은 편집 UI)로 교체.
- store: `pages/design/index.tsx`의 `quota` 소비부(`:121`, `canFinalize :378-380`)와
  `finalize-dialog.tsx`의 잔여 횟수·리셋 Callout(`:132-136, 165-175`) 삭제. 다이얼로그에
  소모 토큰 표기(생성 프롬프트바와 같은 방식). 토큰 부족이어도 다이얼로그는 열린다 —
  U23 결함은 이것으로 소멸.

## 3. 프리뷰 통합

`TieCanvas`(`packages/shared/src/components/tie-canvas.tsx`)는 CSS `background-image`
기반이라 `imageSrc`에 실사화 PNG의 `result_url`을 **그대로 넣으면 된다** — CORS·canvas
taint 무관, 결과물이 seamless 타일이라 타일 반복 뷰도 동일하게 동작한다.

- `finalized-list-modal.tsx`의 평면 `ImageFrame`(`:116-137`)에 캔버스와 같은
  넥타이/타일 토글(`ui/view-toggle.tsx`)을 붙인다.
- §1 완료 후에는 finalize 응답 직후 같은 뷰로 결과를 바로 보여준다(모달 재사용).
- 주문제작 피커(`ui/design-picker.tsx`)는 평면 썸네일 유지 — 선택 UI라 충분.

## 4. 명세·문서·검증

- `docs/api-spec/worker-pipeline.md` §4(엔드포인트 계약)·§5(큐·lease·쿼터 문단)를
  동기·토큰 과금으로 재작성. `docs/api-spec/domains.md`의 finalize·jobs 행 갱신.
  `docs/api-spec/money.md §6` 표에 실사화 5토큰 추가.
- `docs/plans/token-pricing-recalibration.md`의 실사화 행("무과금 (10회/일)")을 갱신.
- api 스펙 변경 커밋에 `pnpm codegen` 생성물 포함(CI drift 검사).
- 테스트: finalize 관련 api 테스트(쿼터 → 과금·환불로 교체, testcontainers), worker 골든
  테스트는 렌더 본체 불변이므로 그대로 통과해야 한다. 폴링·취소 테스트 삭제.
- 완료 후 결과를 `docs/reviews/`에 기록하고 이 플랜 삭제. U12(실사화 끝낸 세션이
  "작업 중" 표시) 잔존 여부도 그때 확인.

## 부록 A — §0 게이트 실패 시(async 유지) 과금 경로

동기 전환 없이 과금만 얹으면 환불 지점이 흩어진다. 이 경우에만:

- 차지: job INSERT 트랜잭션에서 `use_tokens(work_id=f"design_finalize_{job.id.hex}")`.
- 환불 4곳: ① `_fail_finalize_dispatch` ② cancel 엔드포인트 ③ stale 회수
  (`resolve_stale_finalize_jobs`) ④ worker 영구 실패 시 — worker는 DB를 직접 쓰므로
  api의 `GET /design/jobs/{id}` 폴링 시점에 failed && 미환불이면 lazy 환불(멱등 work_id로 안전).
- 이 복잡도가 부록으로 밀려난 이유 자체가 §1을 먼저 해야 하는 근거다.
