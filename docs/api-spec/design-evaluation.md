# 디자인 의미 정확도 평가 v1

2026-09-08 도입. **한국어 기준 30건과 오프라인 채점기이며, 실제 모델의 정확도 측정 결과가 아니다.**
평가 기준은 에이전트가 작성한 `review_status=draft`다. 사람이 문장·조건을 검토한 후에만 `reviewed`로 바꾼다.
런타임 생성·과금·worker HTTP 계약은 변경하지 않는다.

## 데이터와 평가 범위

- 기준: [design_accuracy_cases.json](../../apps/worker/scripts/design_accuracy_cases.json)
- 실행: [eval_design_accuracy.py](../../apps/worker/scripts/eval_design_accuracy.py)
- 채점기 검증: [test_design_accuracy.py](../../apps/worker/tests/test_design_accuracy.py)
- 기존 유료 평가: [eval_authoring.py](../../apps/worker/scripts/eval_authoring.py). 컴파일·RAG·지연 평가를 유지한다.

| 사례 | 수 | 판정 대상 |
|---|---:|---|
| accuracy-001~008 | 8 | 첫 생성: 색 역할, 모티프 identity, 줄 방향, 격자·엇갈림·산개 개수 |
| accuracy-009~026 | 18 | 수정: 대상 회전·크기·밀도, 나머지 보존, 줄 중심/빈 공간 중심, 전역 배율 |
| accuracy-027~030 | 4 | 거절: 모티프 재색·없는 대상·모티프 교체·없는 줄 사이 배치 |

`regression` 20건과 `held_out` 10건은 **앞으로 학습/예시에 쓰지 않을 집합 구분**이다.
실제 RAG 집합과의 중복 검사나 독립적인 사람 검토가 완료됐다는 뜻이 아니다.
프로덕션 few-shot에 이 파일을 시드하지 않는다. 실제 모델 비교 전 유사 예시의 누출을 별도로 확인한다.

모티프는 파일에 고정된 노란 원(`eval-circle`)·하늘색 별(`eval-star`) symbol을 명시적 catalog로 전달한다.
실제 SVG 합성까지 수행하지만 PNG·VLM·DB·외부 provider는 사용하지 않는다.
첫 생성에서는 `input_motif_ids` 순서로 해당 symbol을 제공한 결과만 이 기준으로 평가한다.
카탈로그 검색·고양이 등 자연어 대상 식별 정확도는 이 작은 fixture 평가의 범위 밖이다.

편집 baseline은 fixture에 고정되어 있다. `rotated` → `red_rotated` 맥락 사례는 앞서 적용된 회전 보존을 검증한다.
모델의 이전 오답을 다음 턴에 연결하는 end-to-end 대화 평가는 아직 수행하지 않는다.
크기와 면적은 현재 엔진의 설계 단위이며, mm 값을 실물 생산 치수의 정확도라고 해석하지 않는다.

## 정답 조건

사례의 `checks`를 모두 만족해야 통과한다. 조건은 정답 SVG와의 바이트 일치가 아니라 속성·관계 판정이다.

| 연산 | 의미 |
|---|---|
| `eq` | 지정 값과 같음. 배열은 순서를 포함해 비교 |
| `unchanged` | 같은 fixture의 관측값과 같음 |
| `lt_before` / `gt_before` | baseline보다 실제 값이 감소/증가. 동일 값은 실패 |

숫자 비교는 절대·상대 오차 각각 `1e-6`을 허용한다. 문자열·ID는 정확히 비교한다.
배치 좌표는 정렬해서 비교하므로 반환 순서는 무관하다. 필수 사실이 없으면 실패하며, 없는 모티프의 위치를 통과시키지 않는다.

| 사실 | 계산 기준과 한계 |
|---|---|
| `background.color`, `stripe.colors` | 실제 선택된 colorway의 해석색. palette의 표시용 hex를 채점하지 않음. 불투명 레이어의 RGB hex 조건이며 최종 가림·블렌딩 색 측정은 아님 |
| `stripe.count/angle/geometry` | 유효한 stripe 레이어 수·각도·밴드 폭/간격. geometry에는 색을 포함하지 않음 |
| `motif.ids` | opacity가 0보다 큰 레이어의 fixture ID 목록. 같은 motif ID가 여러 레이어에 있으면 이 평가에서는 모호한 입력으로 실패 |
| `size_mm`, `placement`, `drop` | 최종 intent의 크기·배치 종류·엇갈림 비율 |
| `positions`, `centers`, `rotation` | 실제 `place()` 결과. positions는 회전을 포함하고 centers는 좌표만 비교 |
| `count`, `count_fulfilled` | 경계 clone을 제외한 실제 인스턴스 수. 요청 count 대신 반환 개수를 검사 |
| `density` | 실제 인스턴스 수 / tile_mm². 타일 확장으로 개수만 증가한 것을 밀도 증가로 오판하지 않음 |
| `appearance` | 크기·실제 위치/회전·opacity·모티프끼리의 그리기 순서. 무관한 레이어 번호 재정렬은 허용 |
| `normalized_positions`, `relative_size` | 좌표·크기를 tile_mm으로 나눔. 전역 배율 변경의 비율 보존 검사 |
| `lane`, `stripe_host` | 실제 존재하는 stripe host와 정규화된 lane 연결. 중심선 연결만 검증 |
| `lane_contains_shape` | 회전 반영 AABB 전체가 lane이 가리키는 띠 안에 들어가는지. `b{i}.center`는 밴드, `b{i}.gap`은 빈 공간이 기준이며 경계 clone도 함께 본다. 중심만 사이에 있는 것과 도형 전체가 들어간 것을 가르는 조건이다. 시작/끝 lane은 면적이 없어 이 사실을 내지 않음 |
| `self_overlaps`, `motif.overlaps` | 경계 clone까지 포함한 인스턴스 쌍 중 회전 반영 AABB가 겹치는 수(레이어 내부 / 전체). **AABB는 과대추정**이라 0은 비겹침 증명이지만 양수는 후보 쌍일 뿐이다 — 가는 도형·곡선은 실제로 안 겹칠 수 있다. 명세가 격자에서 15%까지의 겹침을 허용하므로 이 값은 진단이며, 겹침 0을 요구하는 조건은 사례가 명시할 때만 쓴다 |
| `rejection` | 저장된 거절 이유와 기대 이유 일치. 과금 환불·턴 삭제는 별도 API 테스트의 책임 |

알파 마스크 대조(AABB가 겹친 후보에만 적용)는 아직 없다 — 마스크 해상도·임계값·안전 여백을
먼저 정해야 하므로 남은 플랜으로 둔다. 그때까지 겹침 판정은 AABB 수준의 진단이다.

`compose_design`이 반환한 정규화 intent를 사용한다. 따라서 validator repair 이후를 검사한다.
관측 입력은 worker가 제약 적용까지 마친 **최종 resolved intent**여야 한다. 저작 Plan이나 적용 전 patch를 그대로 입력하지 않는다.
평가기가 production 전처리를 전부 재실행하는 것은 아니므로 제공된 입력이 실제 최종 산출물인지 수집 단계에서 보장한다.
geometry 충돌·seam·미적 균형·물리 색 재현은 별도 평가 대상으로 남는다.

## 실행과 입력

코퍼스의 ID·baseline·조건 이름·fixture SVG 합성이 유효한지 무료로 확인한다.

```bash
uv run python apps/worker/scripts/eval_design_accuracy.py --check-corpus
```

실제 저장 결과는 JSON 배열로 준비하고 다음 명령으로 채점한다.

```bash
uv run python apps/worker/scripts/eval_design_accuracy.py --outputs /private/tmp/design-observations.json
```

각 배열 원소는 다음 필드를 사용한다.

| 필드 | 내용 |
|---|---|
| `case_id` | 코퍼스의 사례 ID |
| `intent` | 성공한 worker 최종 intent 객체. 실패/거절이면 생략 |
| `rejection` | 거절 이유 문자열. 성공이면 생략. intent와 동시에 제공할 수 없음 |
| `colorway_id` | 실제 선택된 colorway. 생략하면 엔진 기본 선택을 사용 |
| `seed` | 실제 적용 seed override. 생략하면 intent.seed 사용 |

거절 결과 한 건의 예: `{"case_id":"accuracy-027","rejection":"motif_recolor"}`.
전체 제출에서 관측값이 누락된 사례는 분모에 남고 실패한다. 부분 평가가 필요하면 `--corpus`로 명시적으로 축소한 별도 코퍼스를 제공한다.
중복/미등록 case ID와 잘못된 스키마는 평가 입력 오류다. 입력 오류 메시지는 JSON 원문을 출력하지 않는다.

출력에는 코퍼스 revision/hash, 채점기 revision, 엔진 버전, 전체/모드/분할/조건별 통과 건수,
전 조건 충족률, 예상치 못한 거절 건수, 사례별 오류·실패 조건 인덱스(0부터)를 싣는다.
문장·intent·SVG 원문은 결과 보고서에 복제하지 않는다.
종료 코드는 **0=전 사례 통과 또는 코퍼스 검사 성공, 1=불합격 사례 있음, 2=입력/실행 오류**다.

## 기준선 채택

1. draft 문장과 조건을 검토한다. 상대 표현은 방향만 검사하므로 “조금”의 체감 정도까지 측정했다고 주장하지 않는다.
2. 실제 비교에서 모델·prompt/compiler revision, 생성 코드 SHA, 사용한 사례·catalog/RAG 집합, 호출 반복 횟수를 함께 기록한다.
   코퍼스 hash와 엔진 버전만으로 생성 조건 전체가 재현되는 것은 아니다.
3. 새 실패는 컴파일 오류와 의미 오류를 구분한다. retrieval/authoring 세부 귀속과 지연은 기존 유료 평가·생성 diagnostics와 대조한다.
4. 현재 테스트의 수작업 후보 30건 통과는 **채점 기준의 충족 가능성 검사**다. 실제 모델 100% 정확도를 뜻하지 않는다.

원자 조건과 의존 관계 설계는 [T2I-CompBench](https://arxiv.org/abs/2307.06350)와
[DSG](https://arxiv.org/abs/2310.18235)를 참고했다(2026-09-08 조사). 여기서는 이미지 질문응답 대신 intent·좌표를 직접 판정한다.
