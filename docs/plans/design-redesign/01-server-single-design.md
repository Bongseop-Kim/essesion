# 1단계 — 후보 제거, 결과 1개, 스텝 이동

> 총괄: `00-overview.md`. 이 단계는 서버만 건드린다. store는 4단계에서 새 계약에 맞춘다.
> 이 단계가 끝나면 store 빌드는 깨진다 — **의도된 것**이며 호환 계층을 만들지 않는다.

## 목표

한 번의 생성이 **디자인 1개**를 만들고, 세션은 그 디자인들의 선형 이력을 갖는다.
"후보 N개 중 선택"은 코드·스키마·문서에서 사라진다.

## 현재 상태 (근거)

| 위치 | 내용 |
|---|---|
| `apps/api/.../design/router.py:402` | `DesignGenerateRequest.candidate_count = Field(1, ge=1, le=4)` |
| 같은 파일 `:457` | `DesignRerollRequest.candidate_count = Field(4, ...)` |
| 같은 파일 `:481` | 턴 payload `candidate_count` |
| 같은 파일 `:1184 / :1261 / :1411` | select / reroll / branch 엔드포인트 |
| 같은 파일 `:115-132` | `DesignSessionOut` — `current_intent`·`current_plan`은 이미 내려간다 |
| `apps/worker/.../api/schemas.py:120` | `candidate_count: int = Field(default=1, ge=1, le=8)` |
| `apps/worker/.../engine/candidates.py:327-514` | `_layout_variants`·`_stripe_variants`·`_lattice_cell_variants`·`_motif_size_variants` 팬아웃 |
| `apps/worker/.../api/routes.py` `GenerateResponse` | `intents`·`plans`·`structural_fingerprints`·`candidates` 전부 배열 |

## 작업

### api

1. `candidate_count`를 요청·턴 payload·응답에서 **삭제**한다. 필드를 1로 고정하지 말고 없앤다.
2. `DesignGenerateOut`을 단일 결과로 바꾼다: `candidates: list[...]` → `design: DesignOut`
   (`id`·`seed`·`colorway_id`·`svg`·`png_object_key`·`layout_id`·`source_fidelity`).
3. `POST /design/sessions/{id}/reroll`(`:1261`)과 `.../branch`(`:1411`) **삭제**. 관련
   요청 모델(`DesignRerollRequest`)·테스트·api-client 사용처까지.
4. `select`(`:1184`)를 **스텝 이동**으로 개명·단순화한다.
   - 새 경로: `POST /design/sessions/{session_id}/steps/activate`, 바디 `{ "run_id": uuid }`
   - `candidate_id`·`design_index` 인자 제거 — run 1개당 디자인 1개이므로 run_id로 충분하다.
   - 동작은 현행 유지: 해당 run의 intent·plan을 `current_intent`/`current_plan`으로 커밋,
     `context_version += 1`, 선택 턴 기록. 과거 run도 대상이 된다(되돌리기).
5. `DesignSessionOut`에 `current_motifs: list[CurrentMotifOut]` 추가.
   - `CurrentMotifOut = { motif_id: str, name: str | None, preview_svg: str }`
   - `current_intent`의 motif 레이어에서 `params.motif_id`를 모아 `motifs` 테이블에서 조회한다
     (`UserMotifOut`처럼 `preview_svg`를 만들어 내린다 — `:215` 참고). 카탈로그 모티프도
     포함돼야 한다(현재 `GET /design/motifs`는 내 라이브러리만 돌려준다).
   - 최대 2개. 이름은 `user_motifs.name`이 있으면 그것, 없으면 null(프론트가 슬롯 번호로 표시).
6. 턴 payload 스키마 정리: `candidate_summaries`(0–3 인덱스)를 단일 `summary: str | None`로,
   `mode: Literal["prompt","variation"]`에서 `variation` 제거(reroll 폐기).

### worker

7. `GenerateRequest.candidate_count` 삭제. 응답을 단일화한다: `intents`/`plans`/
   `structural_fingerprints`/`candidates` → `intent`/`plan`/`structural_fingerprint`/`design`.
8. `engine/candidates.py`에서 팬아웃 삭제: `_layout_variants`, `_stripe_variants`,
   `_with_stripe_band_ratio`, `_with_stripe_rhythm`, `_lattice_cell_variants`,
   `_with_lattice_cells`, `_motif_size_variants`, `_with_motif_size`, `_with_lattice_drop`,
   `_is_lattice_layer`, `RankedCandidate`, `CandidateSet`, `_clustering_score`, `_has_scatter`,
   `generate_candidate_set`. `generate_candidates`는 **intent 1개 → 디자인 1개**를 만드는
   함수로 남기고 이름을 `compose_design`으로 바꾼다.
9. 저작 경로에서 "여러 plan 생성 후 구조적 구별 검사"를 제거한다(`gemini.py`의
   `_parse_indexed_plans`·"fewer than 2 valid, structurally distinct plans" 재시도 로직).
   plan 1개를 만들고 검증에 실패하면 재시도한다.
10. `resolve_motifs` 루프가 `designs` 리스트를 도는 부분을 단일 design 처리로 바꾼다
    (`routes.py:940-1000` 근처). Recraft 예산·provenance·trace는 그대로 유지한다.

### DB

11. 베이스라인을 직접 수정한다. 새 마이그레이션을 쌓지 않는다.
    - 후보 개념이 담긴 컬럼·제약이 있으면 제거(현재 `design_session_turns.payload`는 JSONB라
      스키마 변경은 없다 — payload 형태만 바뀐다).
    - 로컬은 `docker compose down -v` 후 `up -d` → `alembic upgrade head` → 시드 재실행으로
      다시 만든다. 기존 세션·턴 데이터는 폐기한다.
12. `tests/test_migrations.py`의 head↔base 왕복과 model drift 검사를 통과시킨다.

## 삭제 목록 (이 단계에서 사라지는 것)

- api: `DesignRerollRequest`, reroll·branch 핸들러, `candidate_count`, `candidate_summaries`,
  `mode="variation"`, `DesignSelectionRequest.candidate_id`
- worker: 8·9항의 함수·클래스 전부, `candidate_count`
- 테스트: 후보 개수·변주·reroll·branch를 검증하는 케이스 전부(대체 케이스를 새로 쓴다)

## 검증

- `uv run pytest` — api design 통합 테스트(testcontainers 실제 Postgres)와 worker 전체
- 인가 테스트는 mock 금지 규칙 유지 — `steps/activate`의 소유자 검사 케이스를 추가한다
- 결정론 계약: 같은 intent+seed → byte-identical SVG. `../git/seamless-tile` 기준선 대조
- `pnpm codegen` 후 `packages/api-client` 생성물을 같은 커밋에

## 완료 판정

1. `grep -rn "candidate_count" apps/ packages/api-client/src` 결과 0건(dist 제외)
2. `/design/generate` 응답에 배열이 없다
3. 과거 run의 `run_id`로 `steps/activate`를 호출하면 `current_intent`가 그 시점으로 이동하고
   `context_version`이 1 증가한다 (테스트로 고정)
4. `GET /design/sessions/{id}`가 `current_motifs`에 preview_svg를 포함해 최대 2개를 돌려준다
