# 재설계 1단계 — 후보 제거, 결과 1개, 스텝 이동

실행일: 2026-07-31

상태: 서버 구현·검증 완료. store 빌드는 **의도적으로 깨진 상태**(4단계에서 새 계약에 맞춘다).

범위: `docs/plans/design-redesign/01-server-single-design.md` 전체. 한 번의 생성이 디자인
1개를 만들고, 세션은 그 디자인들의 선형 이력을 갖는다. "후보 N개 중 선택"은 서버 코드에서
사라졌다.

## 변경

### worker

- `engine/candidates.py` — 전면 재작성. 팬아웃(`_layout_variants`·`_stripe_variants`·
  `_lattice_cell_variants`·`_motif_size_variants`·`_with_*`·`RankedCandidate`·`CandidateSet`·
  `_clustering_score`·`_has_scatter`·`generate_candidate_set`)을 전부 삭제하고,
  `compose_design(intent) -> ComposedDesign` 하나만 남겼다(약 520행 → 80행).
  - 컬러웨이 미지정 시 선택 규칙은 후보 랭킹이 쓰던 기준을 유지한다: **distinct color 수가
    가장 적은 컬러웨이, 동수면 id 순**. 그래야 단일 결과가 예전 rank 1위와 같은 색으로 나온다.
  - 미사용이던 `registry_version` 인자는 함께 제거했다.
- `api/schemas.py` — `GenerateRequest.candidate_count` 삭제. `CandidateOut` → `DesignOut`
  (`design_index` 제거). `GenerateResponse`: `intents`/`plans`/`structural_fingerprints`/
  `candidates` → `intent`/`plan`/`structural_fingerprint`/`design`.
- `api/routes.py` — `_render_candidates`(semaphore + gather) → `_render_design` 단건.
  `_GenerateOutcome`을 단수화. `resolve_motifs`·`snapshot_resolved_plan`·색 바인딩 루프를
  디자인 1개 처리로. Recraft 예산·provenance·trace는 그대로다.
  실패 코드 `candidate_invalid` → `design_invalid`, 진단 키 `candidate_ms` → `compose_ms`.
- `adapters/gemini.py` — `author_designs` → `author_design`(단수 반환). `_parse_indexed_plans`,
  "fewer than 2 valid, structurally distinct plans" 재시도, 구조적 fingerprint de-dup,
  `motif_source_signature` 단일 소스집합 가드를 모두 삭제. 초기 저작도 refine과 같은
  `complete_model(DesignPlanV3)` 한 경로를 쓰고, 검증 실패하면 재시도한다.
- `authoring/schema.py` — 참조가 끊긴 `DesignPlansV3`·`motif_source_signature` 삭제.
  `_canonical_motif_source`는 `structural_fingerprint`가 계속 쓴다.
- `scripts/eval_authoring.py` — 다양성 지표(`structural_diversity_pass_rate`,
  `average_valid_designs`, `average_distinct_structures`) 삭제. 측정 대상이 없어졌다.

### api

- `DesignGenerateRequest.candidate_count`, `DesignRerollRequest`, reroll·branch 핸들러,
  `DesignSelectionRequest.candidate_id`, `FinalizeRequest.candidate_id`, `DesignCandidateSummaryPayload`,
  `mode="variation"` 삭제.
- `DesignGenerateOut.candidates: list[...]` → `design: DesignOut`.
- `POST /design/sessions/{id}/select` → **`POST /design/sessions/{id}/steps/activate`**,
  바디 `{run_id}`. 동작은 현행 유지(해당 run의 intent·plan을 커밋, `context_version += 1`,
  턴 기록, 과거 run도 대상). 턴 payload `type`도 `select` → `activate`.
- `_resolve_design_candidate` → `_resolve_design_run(run_id)` — `design_index` 없이 로그의
  단일 디자인에서 intent·plan·seed·colorway를 복원한다.
- 턴 payload: `candidate_summaries[]` → `summary: str | None`.
- `DesignSessionOut.current_motifs: list[CurrentMotifOut]` 추가
  (`{motif_id, name | null, preview_svg}`, 레이어 순서, 최대 2). 카탈로그 모티프도 포함하고,
  이름은 `user_motifs.name`이 있을 때만 채운다. 단건 GET과 `steps/activate` 응답에만 담고
  목록은 N+1을 피해 빈 배열이다.
- finalize 출처 검증은 `run_id` 단독으로 — `activate` 턴이 이 세션에 있어야 하고,
  복원한 intent가 요청 intent와 같아야 한다.

## 남긴 것 (근거)

- **`seamless_generation_logs`의 `candidate_count_requested`/`candidate_count_returned`/
  `distinct_layouts`/`available_strategies` 컬럼**과 `intent.designs` JSON 배열,
  `candidates` JSON 배열(원소 1개)은 유지했다. admin 생성 관측 화면이 직접 읽고,
  1단계는 "서버만 건드린다"·admin 단수화는 6단계 몫이기 때문이다. 워커는 이제 전부
  상수 1을 쓴다. 따라서 플랜의 완료 판정 1
  (`grep -rn "candidate_count" apps/`가 0건)은 **요청·응답 필드 기준으로만** 성립하고,
  `candidate_count_requested` 같은 관측 컬럼은 6단계에서 함께 지워야 한다.
- 진단 `candidate_ms`는 `compose_ms`로 이름만 바꾸며 admin 쪽(`admin/generation.py`,
  `seamless-detail.tsx` 라벨 1줄 + 테스트)도 같이 고쳤다. 그대로 두면 합성 소요시간이
  1–6단계 내내 `-`로 표시된다. `plan_count`/`validated_count`/`candidate_count` 진단은
  단일 플랜에서 상수라 워커가 더 이상 기록하지 않는다(admin은 `-`, 6단계에서 행 제거).
- DB 스키마 변경 없음 → 새 마이그레이션도, 베이스라인 수정도 없다.
  `tests/test_migrations.py` 통과.

## 검증

```
uv run pytest         # 1202 passed
uv run ruff check .   # clean
uv run pyright        # 0 errors
pnpm lint             # clean
pnpm codegen          # 생성물 동봉
pnpm --filter admin test   # 229 passed
```

- 결정론 계약: `test_compose_design_matches_original_engine`이 `golden/candidates.json`의
  1위 후보(layout `8a7aaa006300`, colorway `default`, seed 20240)와 id·layout·colorway·seed·
  **SVG 바이트**까지 대조한다. seamless-tile 기준선 유지.
- 인가: `test_activate_accepts_past_run_within_session_only`에 소유자 아닌 사용자 403 ·
  비로그인 401 · 다른 세션 run 409를 추가했다(mock 없이 testcontainers Postgres).
- `test_session_reports_current_motifs_including_catalog` — 카탈로그+내 모티프 2개를
  레이어 순서대로, preview_svg 포함해 내려준다. 목록은 빈 배열.
- `store typecheck`는 실패한다(의도). `admin build`는 `VITE_API_BASE_URL` 미설정으로
  실패하며 이번 변경과 무관한 로컬 환경 문제다.

## 데이터

기존 `design_sessions`/`design_session_turns` 행의 payload는 새 스키마로 읽히지 않는다
(`candidate_count`, `candidate_summaries`, `type="select"`). 스키마 변경이 없으므로
`docker compose down -v` 대신 해당 두 테이블만 비우면 된다:

```bash
docker compose exec -T db psql -U essesion -d essesion -c "delete from design_sessions"
```
