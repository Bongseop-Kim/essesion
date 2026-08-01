# 재설계 6단계 — admin 단수화, 죽은 코드 스윕, 문서 정리

실행일: 2026-08-01

범위: `docs/plans/design-redesign/06-cleanup-and-docs.md` 전체. 저장소에서 "후보"·"패턴 4축"·
"전체 재저작(refine)" 개념을 코드·스키마·문서·테스트에서 제거하고, 미결 M1(과금)을 확정했다.
1–5단계 리뷰가 "6단계 몫"으로 남긴 항목을 전부 처리했다.

## 확정 — 미결 M1 (과금)

**첫 생성과 구성 수정의 단가를 분리한다.** 사용자 결정.

| 행위 | 키 | 기본값 |
|---|---|---|
| 첫 생성 (전체 저작 + 모티프 해석) | `admin_settings.design_token_cost_openai_render_standard` | 5 |
| 구성 수정 (patch, flash-lite 1콜) | `admin_settings.design_edit_cost` | **2** (신규) |
| 모티프 검색·교체 | — | 0 |
| 모티프 생성 (Recraft) | — | 0 토큰 + 세션 예산 3회 |
| 범위 밖 거절(`scope_rejected`) | — | `work_id` 멱등 환불 |

- `ledger.get_generate_cost` → `get_cost(session, cost_key=TOKEN_COST_SETTING)`,
  `use_tokens(..., cost_key=...)`. `/design/generate`가 `conversation_context is not None`
  (= 커밋된 디자인을 고치는 요청)일 때만 `design_edit_cost`를 쓴다. 환불은 `_start_generation`이
  돌려준 실제 `charge_cost`를 그대로 뒤집으므로 단가가 갈려도 보상 로직은 그대로다.
- **기본값 2는 시드값이다** — admin 설정 화면에서 1~1000으로 바꿀 수 있다. 0을 넣으면
  `get_cost`가 `token_cost_not_configured`(503)로 막는다(기존 계약 유지).
- **admin 설정 화면**: 지금까지 생성 단가는 allowlist(`SETTING_KEYS`)에 없어 SQL로만 바꿀 수
  있었다. 두 키를 함께 추가해 비대칭을 없앴다(`design_token_cost_openai_render_standard`,
  `design_edit_cost`). 새 검증 분기 `TOKEN_COST_KEYS`는 1~1000만 받는다.
- **store 표기**: 토큰 pill 상세가 `디자인 만들기·고치기 1회 N토큰`(단일) →
  `처음 만들기 1회 N토큰 · 고치기 1회 M토큰`. `GET /tokens/balance`에 `edit_cost`를 추가했다.
- **모티프 생성에는 토큰을 매기지 않기로 유지**했다. 따라서 5단계 리뷰가 지적한 대로
  `motif-modal.tsx` 유료 행과 `motif-generate-modal.tsx` 확인 버튼에는 **가격을 붙이지 않았다**
  (`문장 그대로 새로 만들어요 · N번 더 가능` / `이 문장으로 만들기` 그대로).

## 변경

### DB (미배포 베이스라인 직접 수정 — 새 리비전 없음)

`seamless_generation_logs`
- 삭제: `candidate_count_requested`·`candidate_count_returned`·`distinct_layouts`·
  `available_strategies` (워커가 상수 1만 쓰고 있었다).
- `candidates: JSONB[]`(원소 1개 배열) → **`design: JSONB`**(단일 객체).
- 로그 `intent` JSON의 `designs: [x]` → **`design: x`**.

`authoring_promotion_candidates`
- 삭제: `plan_index`(+ `plan_index >= 0` check) — 로그 1행에 플랜 1개라 항상 0이 된다.
  `source_key`도 `{log_id}:{plan_index}` → `{log_id}`.
- 이름 변경: `selected_candidate_id` → **`design_id`**. "선택한 후보"가 아니라 승격 대상
  디자인의 결정론 id다. 플랜은 오소링 승격 **화면**을 건드리지 말라고 했고 그 취지(기능 삭제
  금지)는 지켰다 — `candidates-list.tsx`는 표시 필드 1줄만 바뀐다.

### worker

- `api/routes.py` — 로그 INSERT 3곳에서 상수 관측 컬럼 제거, `candidates=[{...}]` → `design={...}`,
  `intent_log`의 `designs` → `design`(3경로: intent·prompt·patch).
- `engine/patch.py` — `PATCH_AXES` 상수 + `changed_axes` 프로퍼티 추가. `has_changes`는
  `bool(self.changed_axes)`로 줄여 거절 판정과 진단이 **같은 목록**을 본다.
- `_generate_from_patch`가 `diagnostics["patch_axes"]`를 기록한다(거절 케이스도 포함 — 빈 배열이
  거절 근거다).
- `engine/candidates.py` → **`engine/compose.py`** 로 rename. 파일에 `compose_design` 하나만
  남아 있어 이름이 더 이상 내용을 설명하지 않았다.
- `authoring/promotion.py` — **선재 드리프트 수정**(2단계 리뷰 §137이 "6단계에서 함께 본다"로
  남긴 것). 1–3단계가 로그·턴 계약을 바꾼 뒤로 승격 스캔이 **한 건도 잡지 못하는 상태**였다:
  `authoring.plans`(복수) 배열을 찾고, `type="select"` 턴과 `payload.candidate_id`를 매칭하고,
  finalize job의 `params.candidate_id`를 봤는데 셋 다 존재하지 않는다.
  - 새 게이트: `status=success` + `authoring.plan` 존재 + **`run_id` 등가로 succeeded finalize
    job 존재**. 후보 선택이 없어졌으므로 실사화가 유일한 품질 신호다.
  - `_candidate_design_index`·`_selected_finalized_candidate`(70행) → `_design_id`·`_is_finalized`
    (25행). `DesignSessionTurn` 임포트가 사라졌다 — 승격은 더 이상 턴을 읽지 않는다.
  - `rule_reasons`: `["success","selected","finalized"]` → `["success","finalized"]`.

### api

- `admin/generation.py`
  - `SeamlessSummaryOut`에서 후보 3필드 삭제, `SeamlessDetailOut`에서 `available_strategies` 삭제.
  - `SafeCandidateOut` → `SafeDesignOut`(`design_index` 삭제), `candidates: list` → `design: … | None`.
  - `intents: list[dict]` → `intent: dict | None` (`_safe_intents` → `_safe_intent`,
    `_MAX_INTENT_DESIGNS` 삭제).
  - `GenerationDiagnosticsOut`: `plan_count`·`validated_count`·`candidate_count`·`pattern_controls`
    삭제(워커가 기록을 멈춰 admin에 `-`로만 뜨던 것들), **`patch_axes: list[str]` 추가**.
  - `mode` Literal에 **`motif_slot` 추가** — 워커는 3단계부터 이 값을 쓰는데 api allowlist에
    없어서 모티프 교체 런의 생성 방식이 `-`로 뜨던 드리프트를 함께 고쳤다.
  - `GenerationOutcomeOut.selected_candidate_id` → **`reactivated: bool`**. finalize 상관도
    `params["candidate_id"]` 매칭을 버리고 `run_id` 단독으로 바꿨다 — 1단계에서 finalize job
    params에 `candidate_id`가 사라져 **"Finalize 완료"가 항상 "없음"으로 뜨던 버그**다.
  - `WarningCode`에서 `partial_candidates`·`diversity_shortfall`·`candidate_variants_dropped`·
    `design_dropped` 삭제(워커가 더 이상 만들지 않는 문자열) + 대응 정규식·분기 제거.
    `affected` 변수가 상수 1이 되어 함께 없앴다.
  - `_error_projection` 요약에 `design_invalid`·`semantic_mismatch`·`ScopeRejected` 추가,
    죽은 `candidate_invalid` 삭제.
- `admin/authoring.py` — `_candidate_preview`가 `log.candidates` 배열 순회 → `log.design` 직접
  참조. 스키마 필드 `plan_index` 삭제 · `selected_candidate_id` → `design_id`.
- `design/router.py` — `_logged_design`이 배열에서 첫 dict를 꺼내던 것 → `log.design` 직접.
  `_start_generation`/`_dispatch_generation`에 `cost_key` 전달.
- `tokens/` — `get_cost(cost_key)`·`DESIGN_EDIT_COST_SETTING`, `TokenBalance.edit_cost`.
- `admin/configuration.py` — `SETTING_KEYS`/`SettingKey`에 단가 2키 추가 + `TOKEN_COST_KEYS`
  검증(1~1000).
- `scripts/seed.py` — `design_edit_cost: "2"`.
- `worker/api/schemas.py` — 검증 메시지 `"intent reroll must use…"` → `"direct intent must match…"`
  (`reroll` 경로는 1단계에서 사라졌다).

### admin UI

- `seamless-list.tsx` — 후보 열 삭제, 페이지 설명을 "생성 1건 = 디자인 1개"로.
- `seamless-detail.tsx` — `CandidateCard`(4열 그리드) → `DesignCard`(단일). "성능·후보 집계" 카드에서
  후보/레이아웃/전략 3행 삭제 → "성능". "계획 검증" 행 → **"수정한 구성 축"**(patch 축 한글 라벨).
  "생성 Intent"는 `Intent N JSON` 반복 → 단일 `Intent JSON`. "후보 선택" → "이력에서 다시 활성화".
  `warningPresentation`에서 후보 수 인자 2개와 죽은 코드 4개 분기 삭제.
- `generation-labels.ts` — `FAILURE_STAGE_LABELS`의 `candidate: 후보 구성` → `design: 디자인 합성`,
  `motif_resolution` 추가. `GENERATION_MODE_LABELS`에 `motif_slot` 추가, `variation`은
  "다시 만들기"(없어진 기능) → "같은 intent 재렌더". 신규 `FAILURE_CODE_LABELS`(`scope_rejected`
  포함)·`PATCH_AXIS_LABELS`.
- `settings.tsx` — 새 단가 2건의 표기(제목·적용 범위·기본값·영향·편집 경고).
- `candidates-list.tsx` — `row.selected_candidate_id` → `row.design_id` (1줄).

### store

- `token-pill.tsx` — `editCost` prop 추가, 상세 문구 2단가로. `pages/design/index.tsx`가
  `balance.edit_cost`를 넘긴다.

### 문서

| 문서 | 변경 |
|---|---|
| `ARCHITECTURE.md` | §7.1 다이어그램에 patch 경로 추가·`Candidate variation` 노드 삭제, `DesignPlansV3`→`DesignPlanV3`, §7.4에 모티프 생성 세션 예산 3회 명시, §7.5 시퀀스·서술을 스텝·patch·단가 2종으로 재작성, §7.5의 reroll 문단 삭제, §8 admin 상관을 `run_id` 단독으로. §1·§2·§4·§6·§7.2에 흩어진 "후보" 표현 정리 |
| `docs/api-spec/worker-pipeline.md` | §4 원본 API의 후보 개수·배열을 "미승계"로 명시, §5 `motifs/candidates`가 카탈로그 매칭 후보임을 구분, 과금 미확정 문장 → 확정 단가표 |
| `docs/api-spec/worker-engine.md` | §4 `candidates 생성`(팬아웃·rank·de-dup·다양성 경고 전체) → **`compose_design`** 계약으로 재작성, §7 repro를 `logs.design` 단일 객체로, §7.1의 4축 서술에서 폐기 타입명 제거 |
| `docs/api-spec/worker-motifs.md` | 3단계에서 이미 `MotifSpec` 변환 단계(§5-10)가 들어가 있어 확인만. `intent·candidate·generation log` 표현 1건 정리 |
| `docs/api-spec/domains.md` | **§11 디자인 엔드포인트 표 신설** — 현재 `/design` 표면 전체 + 행위별 과금 + 폐기된 3개 엔드포인트 기록 |
| `docs/api-spec/money.md` | §6 차감 비용을 `cost_key` 분기로, 잔액 응답에 두 단가 |
| `docs/specs/worker-refactor.md` | R10 항목에 "후보 개념 자체가 폐기됐다"는 후속 각주 |
| `docs/CHECKLIST.md` | §2에 **로컬·스테이징 DB 재생성**·`design_edit_cost` 행 확인 추가, §6 E2E 문구를 스텝 플로우로 |
| `docs/plans/design-redesign/` | 삭제 (이 문서로 대체) |

## 검증

```
uv run pytest                      # 1199 passed
uv run ruff check .                # clean
uv run pyright                     # 0 errors
pnpm lint                          # clean (check-harness OK)
pnpm turbo typecheck test          # 5/5 · 4/4 (admin 230 · store 50파일 · shared 62)
pnpm codegen                       # 재실행이 생성물을 바꾸지 않음 = 드리프트 0
uv run pytest tests/test_migrations.py   # head→base→head + model drift 통과
VITE_API_BASE_URL=… VITE_TOSS_CLIENT_KEY=… pnpm turbo build   # 2/2
```

- `pnpm turbo build`는 env 없이 실행하면 `VITE_API_BASE_URL`/`VITE_TOSS_CLIENT_KEY` 없음으로
  config 로드 단계에서 실패한다. 이번 변경과 무관한 로컬 환경 문제이며(1단계 리뷰에도 같은 기록)
  두 값을 주면 통과한다.
- 새 테스트
  - `test_composition_edit_charges_the_edit_cost_not_the_generate_cost`(api, testcontainers) —
    첫 생성 5토큰, 이어지는 구성 수정 2토큰을 잔액 차이로 대조.
  - `test_changed_axes_lists_only_the_set_axes`(worker) — `patch_axes` 진단과 거절 판정이 같은
    목록을 본다.
  - `test_worker_records_success_with_actual_render_timing`에 로그 단수 키 단정 추가
    (`row.design`이 dict, `row.intent["design"]`이 dict).
  - `test_scan_registers_only_finalized_successful_runs`(worker) — 승격 게이트 재작성.
    "다른 실행만 실사화" 케이스를 새로 넣어 `run_id` 등가 매칭을 고정했다.
  - admin `seamless-detail.test.tsx` — "생성 결과를 디자인 1개로 표시한다" ·
    "디자인이 기록되지 않은 생성은 빈 상태로 표시한다" · patch 축 라벨 단정.

## 완료 판정 대조

1. **2절 grep 4개 0건** — 코드·live 스펙 기준으로 0건. 다음 3종은 **의도적으로 남겼다**:
   - `docs/reviews/*` — 실행 기록이므로 폐기 이력을 말해야 한다.
   - `docs/api-spec/domains.md`의 "폐기된 엔드포인트: … `reroll` … `branch`" 1줄 — 무엇이
     없어졌는지 남기는 것이 이 줄의 목적이다.
   - `catalog_candidate_count`(진단), `POST /motifs/candidates`(워커), `AuthoringPromotionCandidate`
     — **카탈로그 매칭 후보**와 **오소링 승격 후보**로, 폐기된 디자인 후보와 다른 개념이다.
     플랜 §1도 같은 근거로 오소링 화면을 fence했다.
2. **문서 표 전부 반영** — `docs/api-spec/domains.md`는 플랜이 가정한 "design 엔드포인트 목록"이
   애초에 없었다(파일 전체에 `/design` 언급 0건). 갱신 대신 §11로 **신설**했다.
   `design-generation-controls` 링크 잔존 0건(3단계에서 이미 정리됨).
3. **plans 제거 + reviews 기록** — 이 문서.
4. **과금 키와 store 표기 일치** — `generate_cost`/`edit_cost` 두 값이 잔액 응답 → 토큰 pill로
   그대로 흐른다. admin 설정 화면도 같은 두 키를 편집한다.

## 남긴 것 (근거)

- **`design_sessions.current_plan`** — 3단계 리뷰가 6단계 삭제 후보로 남겼지만, 3단계가 모티프
  생성의 `style_hint`(`_plan_style_hint`) 소스로 **다시 쓰기 시작했다**. 살아 있는 필드다.
- **`AuthoringPromotionCandidate` 테이블·화면 전체** — 오소링 승격은 이번 재설계와 무관한 기능이다.
  드리프트만 고쳤고(스캔이 0건을 반환하던 상태), 컬럼 2개는 의미가 바뀌어 정리했다.
- **`golden/candidates.json`** — 원본 seamless-tile 엔진의 rank 1위 후보 SVG 기준선이다. 파일명이
  출처를 가리키므로 유지했고, `worker-engine.md` §4에 그 이유를 적었다.
- **`POST /motifs/candidates`(워커)** — api의 `motifs/search`가 부르는 카탈로그 검색이다.
  이름의 "candidates"는 매칭 후보를 뜻하므로 그대로 뒀다.

## 데이터

베이스라인을 고쳤으므로 **로컬·스테이징 DB는 재생성이 필요하다**(컬럼 삭제·rename 때문에 기존
볼륨으로는 생성 경로가 깨진다). `docs/CHECKLIST.md` §2에 항목으로 넣었다.

```bash
docker compose down -v && docker compose up -d
uv run alembic -c db/alembic.ini upgrade head
uv run python apps/api/scripts/seed.py
uv run python apps/worker/scripts/seed_motifs.py
uv run python apps/worker/scripts/seed_authoring_examples.py --confirm-live   # Vertex ADC 필요
uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live    # Vertex ADC 필요
```

## e2e

플랜 §6의 기본값대로 **추가하지 않았다**. `e2e/store-money-path.spec.ts`는 여전히 디자인 경로를
다루지 않는다. 디자인 경로는 Gemini·Recraft 의존이 커서 E2E보다 Aside 수동 체크포인트가 낫고,
`.claude/skills/e2e-test-harness/SKILL.md` 게이트를 통과하지 못한다. 대신 과금 분기·승격 게이트·
로그 계약은 testcontainers 통합 테스트로 고정했다(위 "새 테스트").

## 브라우저 확인

하지 않았다. 이번 단계의 store 변경은 토큰 pill 문구 1줄이고, 값은 `GET /tokens/balance` 응답을
그대로 렌더한다(단정은 `pages/design/index.test.tsx`). admin 화면 변경은 컴포넌트 테스트
230건으로 덮었다. 로컬 DB가 새 베이스라인으로 재생성되기 전에는 디자인 생성 자체가 돌지 않아
Aside 구동이 불가능하다 — DB 재생성 후 확인이 필요하면 그때 한다.
