# 결정론 디자인 엔진 정확도 — 2026-09-09 실행 기록

`docs/plans/design-engine-accuracy.md`(제거됨)의 2·3·4·5단계와 6단계의 명세 갱신을 실행했다.
1단계(사람의 기준 검토·실모델 기준선)와 7단계(RAG·샘플러 비교)는 실행 조건이 갖춰지지 않아
[기준선 기록](./design-accuracy-baseline-2026-09-09.md)에서 실행했고, 남은 것은 [후속 플랜](../plans/design-accuracy-followups.md)에 있다.
평가 기반 자체는 [2026-09-08 기록](./design-evaluation-foundation-2026-09-08.md)에 있다.

provider 호출·과금·worker HTTP 계약은 건드리지 않았다. **실모델 정확도는 여전히 미측정이다.**

## 확인한 사실 (실측)

| 입력 | 결과 |
|---|---|
| `place_scatter(tile 48, min_dist 8, count 30)` | seed 0 → 22개, seed 1~5 → 23개. 최소 토러스 거리는 항상 ≥ 8 |
| 구성 patch의 기본 산개(axis 2..10) | axis 2(min_dist 24, count 4)만 4개 중 **2개**. axis 3~10은 요청 개수를 채운다 |
| poisson 산개 레이어 두 개 | 설정이 달라도 **첫 인스턴스 좌표가 항상 같다**(같은 seed → 같은 난수열). 설정이 같으면 전부 같다 |
| 전역 산개 patch + 두 모티프 슬롯 | 두 레이어가 같은 설정을 받아 좌표까지 포개졌다. 격자는 반 칸 위상으로 이미 갈라져 있었다 |
| 현재 seam 가드 | 같은 `<pattern>`을 두 번 그려 비교하므로 경계 클론을 통째로 빼도 통과한다 |

## 적용한 것

| 항목 | 위치 | 변경 |
|---|---|---|
| 산개 개수 미달 경고 | `engine/composition.py`, `engine/compose.py` | `place()` 결과가 요청 `count`보다 적으면 `layer '<id>': scatter placed N of M requested instances (min_dist_mm …)` 경고. `compose()`에 `warnings` 채널을 붙여 `ComposedDesign.warnings`로 나간다. **배치 결과는 그대로** — 좌표·SVG 바이트 불변 |
| 레이어별 난수열 분리 | `engine/intent.py`(`ScatterSpec.seed_salt`), `engine/placement.py`, `engine/constraints.py`, `engine/patch.py` | salt가 있으면 `random.Random(stable_hash(f"{seed}:{salt}"))`. 구성 patch가 산개를 새로 만들 때 **레이어 id**를 넣는다. 내장 `hash()`·레이어 순번·motif_id는 입력에서 제외 |
| admin intent 표시 | `apps/api/.../admin/generation.py` | `seed_salt`를 intent 허용 키에 추가 — 없으면 admin이 읽은 intent로 같은 배치를 재현할 수 없다 |
| 편집 범위 회귀 | `tests/test_patch.py` | 바탕색만 바꾼 patch가 모티프 좌표·크기·회전·정체성을 그대로 두는지, 슬롯 편집이 다른 슬롯의 **렌더 결과**를 건드리지 않는지, 전역 배율이 정규화 좌표·상대 크기를 보존하는지, 클램프 없는 배율이 역변환되는지, 셀 하나만큼 민 격자가 같은 디자인인지, 연속 patch 곱집합이 유효·seamless를 유지하는지 |
| 도형 기준 배치 진단 | `scripts/eval_design_accuracy.py` | 회전 반영 AABB(`seamless.rendered_aabb`, private → public)와 경계 클론으로 `motif.overlaps`·`<motif>.self_overlaps`·`<motif>.lane_contains_shape` 사실 추가. 판정이 아니라 진단이며 겹침 허용 계약은 그대로 |
| 독립 seam oracle | `tests/test_seam.py` | 단일 타일 PNG 모자이크 vs **같은 place() 결과를 이웃 타일 좌표에 직접 깐** 렌더의 픽셀 비교. `<pattern>`·클론 기계를 쓰지 않는 경로다 |

명세: `worker-engine.md` §1·§3·§5·§7.1(`count`는 목표치, `seed_salt` 계약), `worker-pipeline.md` §5(경고 노출 기준),
`design-evaluation.md`(새 사실 3종과 AABB 과대추정 한계).

### 재현성 판정 (6단계)

- **SVG가 달라지는 변경은 없다.** `seed_salt`는 선택 필드이고 없는 intent는 예전 난수열을 그대로 쓴다 —
  저장된 intent의 activate·모티프 교체·export·finalize 재렌더가 전부 옛 좌표를 재현한다. 골든 40여 건 바이트 동일.
- 새 salt는 **구성 patch가 산개 배치를 새로 만들 때만** 붙는다. 저작 컴파일러(`authoring/compiler.py`)는
  건드리지 않았다 — 컴파일 산출물이 바뀌면 `COMPILER_REVISION`과 예시 승격 게이트까지 얽히는데,
  전역 patch 경로가 실제로 포개짐을 만든 경로였다. 저작 경로의 두 산개 레이어는 아직 같은 난수열을 쓴다(남은 플랜).
- 경고 추가는 warning-only다. `worker.warnings`에 문구를 넣지 않아 고객 응답에는 나가지 않고
  admin `warning_groups`의 `generation_warning`으로 묶인다 — 화면에서 개수는 보이지만 요청 개수와의 차이는
  보이지 않으므로, 전용 코드가 필요해지면 api 스키마 변경 + `pnpm codegen`을 동반해 따로 정한다.

## 검증

- `uv run pytest apps/worker/tests -q` **623건 통과**(신규 21건 포함). api `uv run pytest apps/api/tests` 691건 통과.
- 판정기가 실제로 잡는지 확인했다: `constraints.scatter_placement`에서 salt를 빼면
  `test_global_scatter_patch_does_not_stack_the_two_slots`가 실패하고, `clone_instances`를 원본 그대로 돌려주게
  하면 seam oracle의 평균 차가 0.0013 → 9.46(최대 12 → 192)로 뛴다(`test_dropping_boundary_clones_is_actually_detected`).
- 채점기 신규 사실도 틀린 출력에서 걸린다: 두 슬롯을 같은 난수열로 깔면 `motif.overlaps ≥ count`,
  줄 사이 모티프를 14mm로 키우면 `lane_contains_shape=False`.
- `uv run ruff check .`·`uv run pyright`·`pnpm architecture:check` 통과. 공개 API 스키마·프론트 변경 없음(codegen 불필요).
- 브라우저 확인은 같은 날 오후 Aside로 수행했다 — 두 무늬가 실제로 갈리는 것을 확인했다
  ([기준선 기록](./design-accuracy-baseline-2026-09-09.md) §브라우저 실측).

## 채택하지 않은 것

- **Hypothesis 속성 검사**: 잠금 파일에는 있지만 dev 의존성으로 선언돼 있지 않다. 새 의존성을 늘리는 대신
  같은 불변식을 결정론 곱집합 스윕으로 덮었다. 전략을 짜야 할 만큼 입력 공간이 넓어지면 dev 의존성으로 추가한다.
- **Pillow 알파 마스크 겹침 판정**: 같은 날 오후 실측(AABB 오탐 34%)을 근거로 구현했다 —
  [기준선 기록](./design-accuracy-baseline-2026-09-09.md) 참조.
- **정확한 개수 보장(Bridson·Sample Elimination)**: 최소 간격과 지정 개수는 다른 목표이며 기존 바이트가 바뀐다.
  7단계 실측 전에는 판단하지 않는다 — 남은 플랜.
- **저작 컴파일러의 salt**: 같은 날 오후에 조건부로 넣었다(산개 레이어가 둘 이상일 때만) —
  단일 산개 디자인의 컴파일 산출물이 그대로라 `COMPILER_REVISION`은 유지했다.
- **곡선 bbox 정밀화**: 같은 날 오후에 모티프 47건을 실측했다(카탈로그·업로드 0.98~1.00, AI 생성 2건만 0.85·0.95).
  기존 모티프의 identity가 갈리므로 지금은 고치지 않는다 — 재론 조건은 기준선 플랜에 있다.
- **경고를 고객 문구로 승격**: 사용자는 축당 개수를 요청하고 실제 count는 엔진이 유도한다. "30개 중 22개"는
  요청과 대응하지 않아 오히려 혼란스럽다.

## 되돌리는 법

`seed_salt`를 쓰는 저장 intent가 이미 있으면 필드 자체는 남겨야 한다(그 결과를 읽는 호환 경로).
배치를 되돌려야 하면 `constraints.scatter_placement`가 salt를 붙이지 않게만 하면 되고, 기존 intent는 영향이 없다.
경고가 시끄러우면 `composition.py`의 경고 한 줄만 지운다 — 좌표에 영향이 없다.
