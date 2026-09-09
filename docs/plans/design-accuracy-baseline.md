# 디자인 정확도 기준선과 조건부 후속

2026-09-09에 [엔진 정확도 실행](../reviews/design-engine-accuracy-2026-09-09.md)에서 **실행하지 않고 남긴 항목**만 모았다.
1번(기준선)이 끝나기 전에는 2~5번을 실행하지 말고 기다린다 — 비교할 실패 기준이 없으면 알고리즘 교체의 이득을 판정할 수 없다.

## 왜 필요한가

| 근거 | 사실 |
|---|---|
| [평가 명세](../api-spec/design-evaluation.md) | 코퍼스 30건은 `review_status=draft`다. 사람이 문장·조건을 검토하지 않았고 실제 RAG 집합과의 중복도 확인하지 않았다. |
| [실행 기록](../reviews/design-engine-accuracy-2026-09-09.md) | 채점기·회귀·진단은 갖췄지만 **실제 모델 출력은 한 건도 채점하지 않았다.** 통과율은 수작업 후보의 충족 가능성 검사다. |
| [design-evaluation.md](../api-spec/design-evaluation.md) 겹침 항목 | 겹침 판정이 AABB 과대추정 단계에서 멈춰 있다. 가는 도형·곡선의 실제 겹침 여부는 판정하지 않는다. |
| [worker-engine.md](../api-spec/worker-engine.md) §3 | `count`는 목표치이고 dart throwing이 못 채우면 경고만 낸다. 정확한 개수를 요구하는 계약은 아직 없다. |
| [compiler.py](../../apps/worker/src/worker/authoring/compiler.py) | 저작 경로가 만든 산개 레이어에는 `seed_salt`가 없다 — 두 산개 레이어를 낸 plan은 여전히 같은 난수열을 쓴다. |
| [geometry.py](../../apps/worker/src/worker/motifs/geometry.py) | 곡선 경계를 의도적으로 과대추정한다. 같은 명목 크기에서 보이는 크기가 달라지는 원인 후보이며 미측정이다. |

## 범위 밖

LLM 직접 SVG 생성, 매 요청 VLM 검수, 자동 모델 교체, 학습·파인튜닝, 생성 후보 팬아웃.
모티프 색 불변·동기 HTTP·과금 계약과 기존 디자인의 바이트 재현은 유지한다.

## 실행 조건

- 유료 저작 평가는 `--confirm-live` 계약과 **명시적 실행 동의**가 있을 때만. 없으면 provider 호출을 기다린다.
- 현재 예시·모티프 ID·engine/compiler revision을 평가에 고정한다. `.env` 내용은 읽거나 출력하지 않는다.
- 2~5번은 1번의 기준선 수치가 나온 뒤에만. 개선이 측정 오차와 구분되지 않으면 현재 방식을 유지한다.
- 기존 디자인 재현·과거 스텝 활성화·finalize가 깨지는 변경은 배포하지 않는다.

## 절차

1. **기준 코퍼스를 사람이 검토하고 실모델 기준선을 만든다.**
   [design_accuracy_cases.json](../../apps/worker/scripts/design_accuracy_cases.json)의 30건과
   [평가 명세](../api-spec/design-evaluation.md)를 사람이 읽고 확정한다. 검토 전 `reviewed`로 바꾸지 않는다.
   근거: 수작업 후보가 채점기를 통과하는 것과 실제 모델의 의미 정확도는 다르다.
   - held-out 10건이 실제 RAG 예시 집합(`authoring/data/gallery-v1.json`, 승격된 예시)과 겹치지 않는지 확인한다.
   - 실행 동의 후 고정 모티프를 제공한 실제 생성·편집 결과를 모아 `--outputs`로 채점한다.
     최종 resolved intent·선택 colorway·seed를 쓰고, 모델·prompt/compiler revision·코드 SHA·반복 횟수·지연을 함께 기록한다.
   - 고정 baseline 편집 외에 이전 모델 출력을 다음 턴에 연결하는 대화 기준선도 측정한다.
     원·별 fixture는 카탈로그 의미 검색을 검증하지 않으므로 grounding은 별도로 본다.
   - 실패는 생성 diagnostics와 대조해 retrieval/authoring/compiler/placement/render로 귀속한다.

2. **AABB가 겹친 후보에만 알파 마스크 대조를 붙인다.**
   [eval_design_accuracy.py](../../apps/worker/scripts/eval_design_accuracy.py)의 `motif.overlaps` 계산 뒤에 2단계를 둔다.
   근거: AABB는 과대추정이라 가는 도형·곡선의 실제 겹침을 판정하지 못한다.
   - 마스크 해상도·알파 임계값·안전 여백을 먼저 고정하고, 가는 선·안티앨리어싱 오차를 측정해 문서화한다.
   - 저해상도 마스크를 수학적 비겹침 증명으로 쓰지 않는다. 실행 차단이 아니라 오프라인 진단으로만 쓴다.
   - 오탐이 생기면 이 단계를 끄고 AABB 진단으로 되돌린다.

3. **정확한 개수 계약이 필요한지 판단한다.**
   [placement.py](../../apps/worker/src/worker/engine/placement.py)의 poisson 경로가 대상이다.
   근거: 기준선에서 개수 미달이 실제 실패로 잡히지 않으면 샘플러를 바꿀 이유가 없다.
   - 1번의 경고 로그로 실제 미달 빈도를 센다. 구성 patch 기본값에서는 축당 2개(min_dist 24·count 4)만 미달이었다.
   - 미달이 실패로 이어지면 Bridson(간격·생성 효율)과 Weighted Sample Elimination(지정 개수)을 오프라인 비교한다.
     후자가 임의의 최소 간격과 지정 개수를 동시에 보장한다고 가정하지 않는다. 주기 경계·시간·실제 개수·분포를 함께 측정한다.
   - 채택하면 기존 바이트가 바뀐다 — 저장 intent의 재현 경로를 먼저 정하고 `worker-engine.md` §3을 갱신한다.

4. **RAG 예시 구성을 held-out으로 비교한다.**
   [retrieval.py](../../apps/worker/src/worker/authoring/retrieval.py)가 경계다.
   근거: 예시 수·구성의 이득은 현재 엔진의 실패 기준으로만 판정할 수 있다.
   - 예시 없음 / 현재 top-3 / 실패 유형을 보완한 top-3를 같은 held-out 사례로 비교한다.
   - 한 번의 응답으로 결론 내리지 말고 같은 사례를 반복 평가하며 호출 수와 원시 성공 건수를 함께 기록한다.

5. **조건부 정리 — 측정 후에만 손댄다.**
   - 저작 컴파일러의 산개 `seed_salt`: 두 산개 레이어를 낸 plan이 실제로 나오는지 1번에서 확인한 뒤에만.
     넣으면 컴파일 산출물이 바뀌므로 `COMPILER_REVISION`과 예시 승격 게이트(`authoring/promotion.py`)를 함께 판단한다.
   - 곡선 bbox 정밀화([geometry.py](../../apps/worker/src/worker/motifs/geometry.py)): 과대추정과 보이는 크기의 차이를
     fixture로 먼저 측정하고, 문제 사례에 필요한 계산만 고친다. 기존 저장 모티프의 geometry·content hash를 일괄 변경하지 않는다.
   - 산개 개수 미달 전용 경고 코드: 고객에게 보여줄 문구가 정해지면 api 스키마 변경과 `pnpm codegen`을 동반한다.
   - 제한적 재저작(1회 한정): 구체적 위반과 실패 사례가 1번에서 확보된 경우에만. 의미를 추측한 무한 재시도는 금지.

## 검증

- 오프라인: `uv run pytest apps/worker/tests/test_design_accuracy.py apps/worker/tests/test_authoring_eval.py apps/worker/tests/test_scatter_streams.py apps/worker/tests/test_seam.py`.
  전체 Python 스위트를 한 번에 돌리지 않는다.
- provider 평가는 실행 동의 후 `uv run python apps/worker/scripts/eval_authoring.py --confirm-live`와
  `eval_design_accuracy.py --outputs …`. 초기/편집별 결과, 데이터 revision, 조건별 분모, 반복 횟수, 지연을 함께 보고한다.
  개선율을 실행 전 예상 수치로 적지 않는다.
- 배치나 컴파일 산출물이 바뀌면 골든을 먼저 덮어써 통과시키지 말고, 변경 원인과 revision을 기록한다.
- `uv run ruff check .`, `uv run pyright`, `pnpm architecture:check`.

## 되돌리는 법 / 상향 신호

과거 스텝 재렌더 불일치, 비대상 레이어 변경, 실제 seam 결함, 정당한 요청의 새 거절이 생기면 해당 동작 변경을 되돌린다.
평가 fixture·진단 기록은 유지한다. 새 버전으로 저장된 결과가 있으면 그 결과를 읽는 호환 경로까지 제거하지 않는다.

**실패 모드:** 채점기 통과율이나 모델의 자기평가를 실모델 정확도로 포장하는 것, 그리고 기준선 없이 샘플러·RAG를
바꿔 놓고 "개선했다"고 쓰는 것이다.

## 기각한 대안

- 매 요청 VLM 채점: intent·좌표로 판정 가능한 조건에 불필요하다. 분위기·시각적 균형을 봐야 할 때 오프라인 보조로 재검토한다.
- Plan을 버리고 자유 SVG 생성: 타입·컴파일러 경계를 잃는다. 현 표현력으로 제품 요구를 못 담을 때만 재검토한다.
- 무조건 예시 개수 증가: 현재 top-3 개선 이력을 무시한다. held-out 비교에서 이득이 확인되면 재검토한다.
- 골든 전면 대체: 진단·속성 검사는 보완 수단이다. 최소 실패 반례를 회귀 fixture로 남기는 방식으로 확장한다.
