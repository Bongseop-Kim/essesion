# 결정론 디자인 엔진의 의미·배치 정확도 개선

2026-09-08 코드 조사와 웹 자료 검토를 바탕으로 작성한 **남은 작업 플랜**이다.
현재 `문장 → Plan/Patch → 결정론 컴파일·검증 → SVG` 흐름을 유지한다.
먼저 요청 반영 정확도를 측정하고, 확인된 실패만 수정한다. 줄 번호는 작성 시점 기준이며 실행 전 심볼을 다시 찾는다.

평가 기준 초안·오프라인 채점기는 [실행 기록](../reviews/design-evaluation-foundation-2026-09-08.md)으로 옮겼다.
아래에는 사람 검토·실모델 기준선과 아직 실행하지 않은 엔진 개선만 남긴다.

[디자인 생성 신뢰성 작업](../reviews/design-generation-reliability-2026-09-08.md)이 통신·복구·과금을
이미 다뤘고(2026-09-08 실행 완료), 이 문서는 요청 의미·편집 범위·기하·배치 결과를 다룬다.
구현 파일이 겹치면 그 리뷰의 변경과 대조해 합친다.

## 왜 필요한가

| 근거 | 확인한 사실 또는 가설 |
|---|---|
| [eval_authoring.py](../../apps/worker/scripts/eval_authoring.py):63 | 현재 평가는 컴파일 성공·검색 family·시간 위주다. 실제 색·대상·관계 및 편집 보존 조건을 판정하는 정답 조건이 부족하다. |
| [llm.py](../../apps/worker/src/worker/adapters/llm.py):772 | patch는 단일 호출 후 적용된다. 타입상 유효한 patch라도 요청한 대상·축을 잘못 해석할 수 있다. 이는 코드 구조에 근거한 위험이며 전체 오류율은 미측정이다. |
| [placement.py](../../apps/worker/src/worker/engine/placement.py):176 | 로컬 `place_scatter`에 tile=48, min_dist=8, count=30, seed=0을 전달하면 22개를 반환했다. 시도 상한에 도달해도 개수 부족을 오류로 알리지 않는다. 이 결과는 30개 배치가 수학적으로 불가능하다는 증거가 아니다. |
| [composition.py](../../apps/worker/src/worker/engine/composition.py):121 | 각 레이어가 같은 seed를 받는다. 산개 설정이 같은 두 레이어는 동일 좌표를 얻는다. 전역 scatter patch가 이 조건을 만들 수 있으므로 통합 재현이 필요하다. |
| [constraints.py](../../apps/worker/src/worker/engine/constraints.py):101 | 격자 크기 제한은 회전 후 영역을 반영하지 않는다. 중심이 줄 사이에 있어도 실제 모티프가 줄을 침범할 수 있다. 실제 피해 빈도는 미측정이다. |
| [geometry.py](../../apps/worker/src/worker/motifs/geometry.py):1 | 곡선 경계를 의도적으로 과대추정한다. 같은 명목 크기에서 보이는 크기가 달라지는 원인 후보이며, 정규화 변경의 필요성은 샘플 비교로 확인해야 한다. |
| [seam_helpers.py](../../apps/worker/tests/seam_helpers.py):87 | 현재 래스터 seam 지표는 내부의 강한 경계보다 작은 결함을 놓칠 수 있다고 명시한다. 구조 불변식과 독립된 비교 검사를 보강할 여지가 있다. |

이미 완료된 [지명색·대상·엇갈림·슬롯 편집 수정](../reviews/design-intent-fixes-2026-09-07.md)과
[few-shot 역설계 개선](../reviews/design-family-reverse-eval-2026-08-04.md)은 재구현하지 않는다.
그 사례는 회귀 정답으로 재사용하되, 새로운 미공개 평가와 분리한다.
현재 Poisson의 공간 격자 이웃 검색도 이미 구현되어 있으므로 성능 최적화 항목에서 제외한다.

## 범위 밖

LLM 직접 SVG 생성, 매 요청 VLM 검수, 자동 모델 교체, 학습·파인튜닝, 생성 후보 팬아웃은 도입하지 않는다.
모티프 색 불변·동기 HTTP·과금 계약을 유지하며, 물리적 직조 가능성을 자동 판정하지 않는다.

## 실행 조건

- [ARCHITECTURE.md](../../ARCHITECTURE.md), [worker-engine.md](../api-spec/worker-engine.md),
  [worker-pipeline.md](../api-spec/worker-pipeline.md), [authoring-plan-v3.md](../api-spec/authoring-plan-v3.md)를 대조한다.
- 1단계의 오프라인 평가 기반을 먼저 완성한다. 효과를 비교할 정답 사례가 없으면 알고리즘·모델·RAG 변경을 실행하지 말고 기다린다.
- 유료 저작 평가는 기존 `--confirm-live` 계약과 명시적 실행 동의가 갖춰졌을 때만 수행한다.
  조건이 없으면 provider 호출을 기다리고, 저장된 입력·출력 및 합성 intent의 결정론 검사만 진행한다.
- 현재 예시·모티프 ID·engine/compiler revision을 평가에 고정한다. `.env` 내용은 읽거나 출력하지 않는다.
- 기존 디자인 재현·과거 스텝 활성화·finalize가 깨지는 변경은 배포하지 않는다.
  버전 라벨 추가만으로 과거 알고리즘이 복원된다고 가정하지 않는다.

## 절차

1. **평가 초안을 검토하고 실제 모델 기준선을 확보한다.**
   [design_accuracy_cases.json](../../apps/worker/scripts/design_accuracy_cases.json):1의 30건 draft와
   [평가 명세](../api-spec/design-evaluation.md)를 사람이 검토한다.
   근거: 수작업 후보가 채점기를 통과하는 것과 실제 모델의 의미 정확도는 다르다.
   - 문장·조건·held-out 집합을 확정하고 실제 RAG 집합과 중복을 점검한다. 검토 전 `reviewed`로 표시하지 않는다.
   - 실행 동의 후 고정 모티프를 제공한 실제 생성·편집 결과를 수집해 오프라인 채점기에 연결한다.
     실제 최종 intent·선택 colorway·seed를 사용한다. 모델·prompt/compiler revision·코드 SHA·반복 횟수·시간을 함께 기록한다.
   - 고정 baseline 편집 외에 이전 모델 출력을 다음 턴에 연결하는 대화 기준선을 측정한다.
     현재의 원·별 fixture 평가는 카탈로그 의미 검색을 검증하지 않으므로 grounding 평가는 별도로 보강한다.
   - 실패는 기존 생성 diagnostics와 대조해 retrieval/authoring/compiler/placement/render로 귀속한다.

2. **산개 개수 미달과 두 레이어 포개짐을 회귀로 고정한다.**
   [placement.py](../../apps/worker/src/worker/engine/placement.py):176,
   [composition.py](../../apps/worker/src/worker/engine/composition.py):121,
   [patch.py](../../apps/worker/src/worker/engine/patch.py):610을 대상으로 통합 재현을 만든다.
   근거: 함수 수준에서 확인한 차이를 실제 디자인 경로의 실패와 연결해야 한다.
   - 위 30→22 입력과 여러 작은 seed 사례에서 요청/실제 개수·최소 토러스 거리를 기록한다.
     개수 부족은 숨기지 않고 기존 경고 경로로 알린다. `count`가 목표값인지 필수값인지 명세에 명시한다.
     초기 변경은 배치 결과를 유지하고 부족 경고만 추가한다. 명시적 정확 개수 지원은 별도 계약으로 판단한다.
   - 두 모티프에 전역 scatter patch를 적용해 동일 중심 좌표가 생기는지 검사한다.
     독립 배치가 의도된 경로에 한해 전역 seed와 안정적인 레이어 ID로 난수열을 분리하는 변경을 평가한다.
     Python `hash()`와 레이어 순번은 쓰지 않는다. 모티프 교체만으로 좌표가 바뀌지 않게 motif ID도 seed 입력에서 제외한다.
   - seed 분리는 비겹침 보장이 아니다. 요청에 비겹침이 있으면 4단계의 교차 레이어 검사를 사용한다.
     변경 시 6단계의 재현성 조건을 먼저 충족한다.

3. **편집 전후의 변경 범위와 실제 적용값을 검사한다.**
   [llm.py](../../apps/worker/src/worker/adapters/llm.py):772,
   [patch.py](../../apps/worker/src/worker/engine/patch.py):729,
   [routes.py](../../apps/worker/src/worker/api/routes.py):619를 대상으로 평가 검사를 추가한다.
   근거: 유효한 patch와 요청 범위를 지킨 patch를 구분해야 한다.
   - 바탕색만 수정 시 모티프 좌표·크기·회전·정체성 보존, 슬롯 1 수정 시 슬롯 2 보존을 검증한다.
     타일 표현만 달라지는 경우에는 raw JSON 비교 외에 정규화 좌표·면적당 밀도를 비교한다.
   - 요청한 값과 제약 적용 후 값을 구분하고, `note` 문구 대신 실제 차이를 근거로 조정 안내를 만든다.
   - 먼저 오프라인에서 판정한다. 실행 경로에는 구조적으로 확정 가능한 위반만 올린다.
     자연어 전체를 정규식으로 재해석하는 두 번째 파서를 만들지 않는다.
   - 제한적 재저작은 구체적 위반과 실패 사례가 확보된 경우에만 평가한다.
     적용한다면 한 번으로 제한하고 전체 호출·시간 예산을 공유한다. 의미를 추측한 무한 재시도는 금지한다.

4. **실제 도형 기준으로 배치 품질을 검사한다.**
   [constraints.py](../../apps/worker/src/worker/engine/constraints.py):101과
   [seamless.py](../../apps/worker/src/worker/engine/seamless.py):14의 기존 회전 반영 AABB 계산을 재사용한다.
   근거: 중심·셀 크기만으로 모티프 겹침이나 줄 침범을 판정할 수 없다.
   - 우선 평가 도구에서 회전된 도형, 가는 도형, 두 슬롯, 경계 반대편 이웃을 검사한다.
     “줄 사이”는 중심만 사이에 있는 것과 전체 도형이 빈 영역에 들어가는 것을 구분해 정답을 정한다.
   - AABB가 겹치는 후보에만 기존 렌더러/Pillow의 알파 마스크 비교를 적용한다.
     마스크 해상도·알파 임계값·안전 여백을 고정하고, 가는 선·안티앨리어싱 오차를 측정한다.
     저해상도 마스크를 수학적 비겹침 증명으로 사용하지 않는다.
   - 현재 명세는 일정 겹침을 허용한다. 모든 겹침을 오류로 바꾸지 않는다.
     명시적 비겹침 기능을 추가할 경우 hard/soft 조건, 충돌 시 크기·밀도 중 양보할 축,
     해결 불가능 시 거절 방식을 명세로 먼저 정한다. 숨겨진 자동 축소를 추가하지 않는다.
   - 곡선 bbox 정밀화는 조건부다. [geometry.py](../../apps/worker/src/worker/motifs/geometry.py):1의 과대추정과
     보이는 크기의 차이를 fixture로 측정한 후, 문제 사례에 필요한 계산만 개선한다.
     기존 저장 모티프의 geometry·content hash를 일괄 변경하지 않는다.

5. **속성·연속 편집·독립 seam 검사를 보강한다.**
   [test_patch.py](../../apps/worker/tests/test_patch.py):1,
   [test_engine.py](../../apps/worker/tests/test_engine.py):19,
   [test_seam.py](../../apps/worker/tests/test_seam.py):81을 확장한다.
   근거: 고정 골든에 없는 편집 조합과 경계 조건을 탐색해야 한다.
   - 색 수정의 좌표 보존, 슬롯 격리, tile 주기 이동 동치, 허용 범위의 균일 배율, 연속 patch 후 유효성을 검사한다.
     확대/축소 역변환은 clamp가 없는 입력에 한정한다. 표현이 달라도 같은 결과인 경우 SVG 바이트 일치를 요구하지 않는다.
   - 잠금 파일에 있는 Hypothesis를 활용하되 해당 테스트 환경의 의존성을 확인한다.
     작은 유효 입력 전략과 필요한 편집 순서부터 시작하고, 최소 실패 반례를 회귀 fixture로 남긴다.
   - seam 비교는 단일 타일 PNG를 이어 붙인 결과와 충분한 주변 인스턴스를 독립 배치해 렌더한 영역을 비교한다.
     같은 `<pattern>`을 두 번 렌더하는 검사는 독립 oracle이 아니다.
     픽셀 정렬·DPI·renderer를 고정하고, 의도적으로 경계 clone을 누락한 변형을 실제로 검출하는지 확인한다.

6. **출력 변경 전 재현성과 계약을 갱신한다.**
   [worker-engine.md](../api-spec/worker-engine.md) §3·§5·§7.1,
   [worker-pipeline.md](../api-spec/worker-pipeline.md) §5,
   [authoring-plan-v3.md](../api-spec/authoring-plan-v3.md)의 평가 계약을 갱신한다.
   근거: seed·배치·자동 조정 변경은 기존 디자인 재현과 고객 안내에 영향을 준다.
   - warning-only 변경과 실제 SVG 변경을 분리한다. SVG가 달라지면 변경 원인과 engine/compiler revision을 기록한다.
     골든을 먼저 덮어써 통과시키지 않는다.
   - 과거 intent의 activate·모티프 교체·export·finalize 경로를 확인한다.
     이전 배치 재현이 필요하면 기존 버전 경로 또는 저장된 확정 좌표를 사용하는 최소 방식을 선택하고 명세화한다.
     과거 SVG만 보관하면 모든 재렌더 경로가 해결된다고 가정하지 않는다.
   - 모티프 정규화 변경은 [worker-motifs.md](../api-spec/worker-motifs.md)와 함께 새 identity의 적용 범위를 정한다.
     DB 변경은 Alembic, 공개 API 변경은 `pnpm codegen`을 동반한다.

7. **기준선이 확보된 뒤에만 RAG·샘플러 대안을 비교한다.**
   [retrieval.py](../../apps/worker/src/worker/authoring/retrieval.py):59와
   [placement.py](../../apps/worker/src/worker/engine/placement.py):176을 비교 대상 경계로 삼는다.
   근거: 알고리즘 교체의 이득을 현재 엔진의 실패 기준으로 판정해야 한다.
   - RAG는 예시 없음/현재 top-3/실패 유형을 보완한 top-3를 같은 held-out 사례로 비교한다.
     최신 한 번의 응답으로 결론 내리지 말고 동일 사례를 반복 평가하며 호출 수와 원시 성공 건수를 함께 기록한다.
   - 최소 간격·생성 효율이 문제면 Bridson, 지정 개수가 문제면 Weighted Sample Elimination을 오프라인으로 비교한다.
     후자가 임의의 최소 간격과 지정 개수를 동시에 보장한다고 가정하지 않는다. 주기 경계·시간·실제 개수·분포를 함께 측정한다.
   - 구조 필수 조건·기존 골든 회귀가 없고 대상 실패군이 개선된 경우에만 구현 변경을 채택한다.
     개선이 없거나 측정 오차와 구분되지 않으면 현재 방식을 유지한다.

## 검증

- 평가 판정기 자체: 의도적으로 색 대상·슬롯·개수·배치를 틀린 출력이 해당 조건에서 실패해야 한다.
  유효하지만 의미가 틀린 intent를 반드시 포함한다.
- 오프라인: `uv run pytest apps/worker/tests/test_authoring_eval.py apps/worker/tests/test_authoring_v3.py apps/worker/tests/test_patch.py apps/worker/tests/test_engine.py apps/worker/tests/test_seam.py apps/worker/tests/test_geometry.py`.
  한 번에 전체 Python 스위트를 실행하지 않는다. 새 테스트가 다른 파일이면 그 파일만 추가한다.
- provider 평가는 실행 동의 후 `uv run python apps/worker/scripts/eval_authoring.py --confirm-live`로 수행한다.
  평가 확장 시 초기/편집별 결과, 고정 데이터 revision, 조건별 분모, 반복 횟수, 지연을 보고한다.
  개선율을 실행 전 예상 수치로 적지 않는다.
- `uv run ruff check .`, `uv run pyright`, `pnpm architecture:check`를 실행한다.
  공개 API 변경 시 `pnpm codegen`, 프론트 안내 변경 시 해당 테스트와 `pnpm lint`·`pnpm typecheck`를 실행한다.
- 화면 확인이 필요하면 Aside 하네스를 사용하고 서버 기동 전 기존 포트를 확인한다.
  브라우저의 타일/넥타이 배율과 warning 안내를 확인한다. E2E는 완료 체크포인트에서 하네스로 실행 여부를 결정한다.
- 완료 후 채택·기각한 대안, 검증 결과, 남은 조건부 항목의 처분을 `docs/reviews/`에 기록하고 이 플랜을 제거한다.
  미평가 조건부 항목을 완료했다고 쓰지 말고 필요하면 별도 미실행 플랜으로 남긴다. 커밋·푸시는 사람이 한다.

## 되돌리는 법 / 상향 신호

과거 스텝 재렌더 불일치, 비대상 레이어 변경, 실제 seam 결함, 정당한 요청의 새 거절이 발생하면 해당 동작 변경을 되돌린다.
평가 fixture·진단 기록은 유지한다. 새 버전으로 저장된 결과가 있으면 그 결과를 읽는 호환 경로까지 제거하지 않는다.
마스크 판정이 가는 도형을 놓치거나 오탐하면 실행 차단에서 제외하고 오프라인 진단으로 되돌린다.

**실패 모드:** 스키마 성공이나 모델의 자기평가를 의미 정확도로 포장하거나, 예쁜 배치를 만들려다 명시적 크기·밀도·보존 조건을 몰래 바꾸는 것이다.

## 기각한 대안과 조사 출처

아래 자료는 2026-09-08 확인했다. 논문의 효과를 이 엔진에서 실측한 개선율로 간주하지 않는다.

- 매 요청 VLM 채점: intent·좌표로 판정 가능한 조건에 불필요하다. 분위기·시각적 균형을 평가해야 할 때 오프라인 보조로 재검토한다.
  원자 조건·의존 관계의 근거: [T2I-CompBench](https://arxiv.org/abs/2307.06350), [DSG](https://arxiv.org/abs/2310.18235).
- Plan을 버리고 자유 SVG 생성: 기존 타입·컴파일러 경계를 잃는다. 현 표현력으로 필요한 제품 요구를 표현할 수 없을 때만 재검토한다.
  제약된 출력 언어의 연구 사례: [PICARD](https://aclanthology.org/2021.emnlp-main.779/).
- 무조건 예시 개수 증가: 현재 top-3 개선 이력을 무시한다. held-out 비교에서 이득이 확인되면 재검토한다.
  맥락 길이·위치에 대한 연구이며 현재 모델의 직접 증거는 아님: [Lost in the Middle](https://aclanthology.org/2024.tacl-1.9/).
- 샘플러 즉시 교체: 기존 바이트가 바뀌며 정확 개수와 최소 간격은 다른 목표다. 7단계 실측 후 재검토한다.
  [Bridson 논문](https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf),
  [Sample Elimination·주기 경계 공식 설명](https://www.cemyuksel.com/cyCodeBase/soln/poisson_disk_sampling.html).
- 전체 SVG 기하 엔진 재작성: 먼저 실제 실패 도형을 고정한다. 현재 경계 계산의 오차가 요구 수준을 넘을 때만 확장한다.
  [W3C SVG 2 bounding box 정의](https://www.w3.org/TR/SVG2/coords.html#BoundingBoxes).
- 골든 전면 대체: 속성 검사는 보완 수단이다. [Hypothesis 소개](https://hypothesis.readthedocs.io/en/latest/tutorial/introduction.html),
  [연속 상태 검사](https://hypothesis.readthedocs.io/en/latest/stateful.html)를 참고해 작은 반례 중심으로 확장한다.
