# 디자인 의미 정확도 평가 v1

2026-09-08 도입. **한국어 기준 30건과 오프라인 채점기이며, 실제 모델의 정확도 측정 결과가 아니다.**
평가 기준은 에이전트가 작성한 `review_status=draft`다. 사람이 문장·조건을 검토한 후에만 `reviewed`로 바꾼다.
런타임 생성·과금·worker HTTP 계약은 변경하지 않는다.

## 데이터와 평가 범위

- 기준: [design_accuracy_cases.json](../../apps/worker/scripts/design_accuracy_cases.json)
- 수집(유료): [collect_design_accuracy.py](../../apps/worker/scripts/collect_design_accuracy.py) — worker 라우트와 같은 경로로 실모델 출력을 모은다
- 실행: [eval_design_accuracy.py](../../apps/worker/scripts/eval_design_accuracy.py)
- 채점기 검증: [test_design_accuracy.py](../../apps/worker/tests/test_design_accuracy.py)
- 기존 유료 평가: [eval_authoring.py](../../apps/worker/scripts/eval_authoring.py). 컴파일·RAG·지연 평가를 유지한다.

v3에서 고친 것(2026-09-09, 사람 확정): 002는 "설계 단위 4" → "작게" + `relative_size lte 0.125`,
006은 대각선 방향을 문장에 명시(내려가는 대각선 = 45°), 024는 이 계약으로 표현할 수 없는 "타일당 18개" →
축당 개수("축마다 6개씩")로 바꿨다. **0.125는 임의값이 아니라** 예시
`gallery_14_motif_lattice_small_size`의 `size_ratio` — 이 엔진이 "작은 모티프"라고 부르는 크기다.
조건 자체를 느슨하게 만들지 않았다: v1이 낸 0.167은 v3에서도 실패한다.

v3에서 30건이 모두 통과해 변별력이 사라졌으므로 v4에서 7건을 더했고, 그 사례들이 잡은 조건 결함을 고친 것이 v5다(2026-09-09).
추가 근거와 그 결과 드러난 결함은 [기준선 기록](../reviews/design-accuracy-baseline-2026-09-09.md)에 있다.
통과율을 모델 품질의 상한으로 읽지 말고, 만점이 나오면 사례를 늘린다.

| 사례 | 수 | 판정 대상 |
|---|---:|---|
| accuracy-001~008 | 8 | 첫 생성: 색 역할, 모티프 identity, 줄 방향, 격자·엇갈림·산개 개수 |
| accuracy-009~026 | 18 | 수정: 대상 회전·크기·밀도, 나머지 보존, 줄 중심/빈 공간 중심, 전역 배율 |
| accuracy-027~030 | 4 | 거절: 모티프 재색·없는 대상·모티프 교체·없는 줄 사이 배치 |
| accuracy-031~035 | 5 | 첫 생성 변별용(v4): 지명색과 역할의 결합, 명시 hex 준수, 추상 요청 속 명시 조건 |
| accuracy-036~037 | 2 | 수정 변별용(v4): 한 문장이 두 대상을 반대로 움직이기, 한 슬롯만 줄 위로 |
| accuracy-040~045 | 6 | 대화 체인 2개(v6): 첫 생성 → 그 결과를 이어서 2턴 더. baseline이 fixture가 아니라 **직전 턴의 실제 산출물**이다 |
| accuracy-050~052 | 3 | 카탈로그 검색(v7): fixture symbol 없이 문장만으로 그림을 고르게 하고 **subject**로 판정 |

`regression` 24건과 `held_out` 13건은 **앞으로 학습/예시에 쓰지 않을 집합 구분**이다.
프로덕션 few-shot에 이 파일을 시드하지 않는다. 2026-09-09에 활성 예시 25건과의 어휘 겹침을 검사했고
최대 0.17, held-out 중 0.5 이상은 0건이었다 — 누출 검사는 코퍼스를 늘릴 때마다 다시 한다.

모티프는 파일에 고정된 노란 원(`eval-circle`)·하늘색 별(`eval-star`) symbol을 명시적 catalog로 전달한다.
실제 SVG 합성까지 수행하지만 PNG·VLM·외부 provider는 채점 단계에서 사용하지 않는다.

`input_motif_ids`가 빈 사례는 **라우트와 같이 카탈로그 검색을 탄다**(`prompt_catalog_candidates`,
tau는 `motif_similarity_tau`, top-5). 그때 고른 그림은 DB에만 있으므로 수집 단계가 관측치에
`motifs`(id→symbol)·`motif_subjects`(id→subject)·`approximate_match`를 함께 실어 오고,
채점기는 그것으로 합성·판정한다 — 채점기는 여전히 DB를 보지 않는다.
판정 대상은 불안정한 motif id가 아니라 **subject**이며, 카탈로그에 같은 대상의 표기가 둘 이상
있으면(`꿀벌`/`bee`) 어느 쪽도 정답이므로 **표기가 하나뿐인 주제로 사례를 고른다**.

편집 baseline은 기본적으로 fixture에 고정되어 있다. `rotated` → `red_rotated` 맥락 사례는 앞서 적용된 회전 보존을 검증한다.
**`before`에 fixture 대신 앞선 사례 id를 적으면 대화 체인**이 된다(040~045): 그 턴의 baseline은 직전 턴이 실제로 만든
intent이고, `conversation_history`도 실제 문장·note로 채워진다. 1턴의 오답이 2턴으로 전파되며, 체인 턴은
거절된 턴을 이어받을 수 없다(코퍼스 검증에서 막는다).
크기와 면적은 현재 엔진의 설계 단위이며, mm 값을 실물 생산 치수의 정확도라고 해석하지 않는다.

## 정답 조건

사례의 `checks`를 모두 만족해야 통과한다. 조건은 정답 SVG와의 바이트 일치가 아니라 속성·관계 판정이다.

| 연산 | 의미 |
|---|---|
| `eq` | 지정 값과 같음. 배열은 순서를 포함해 비교 |
| `lte` / `gte` | 지정한 수치 상·하한 안(경계 포함). "아주 작게"처럼 baseline이 없는 첫 생성의 정도 표현용 |
| `unchanged` | 같은 fixture의 관측값과 같음 |
| `lt_before` / `gt_before` | baseline보다 실제 값이 감소/증가. 동일 값은 실패 |

숫자 비교는 절대·상대 오차 각각 `1e-6`을 허용한다. 문자열·ID는 정확히 비교한다.
배치 좌표는 정렬해서 비교하므로 반환 순서는 무관하다. 필수 사실이 없으면 실패하며, 없는 모티프의 위치를 통과시키지 않는다.

| 사실 | 계산 기준과 한계 |
|---|---|
| `background.color`, `stripe.colors` | 실제 선택된 colorway의 해석색. palette의 표시용 hex를 채점하지 않음. 불투명 레이어의 RGB hex 조건이며 최종 가림·블렌딩 색 측정은 아님 |
| `stripe.count/angle/geometry` | 유효한 stripe 레이어 수·각도·밴드 폭/간격. geometry에는 색을 포함하지 않음 |
| `stripe.colors_used` | 밴드에 쓰인 해석색의 정렬된 집합. **밴드 개수·순서를 보지 않는다** — "줄무늬는 흰색"처럼 색만 지정한 문장에 쓴다. 구조까지 지정한 문장은 순서 있는 `stripe.colors`를 쓴다 |
| `motif.ids` | opacity가 0보다 큰 레이어의 fixture ID 목록. 같은 motif ID가 여러 레이어에 있으면 이 평가에서는 모호한 입력으로 실패 |
| `motif.subjects` | 카탈로그에서 고른 그림의 subject(정렬). 관측치에 `motif_subjects`가 있을 때만 나온다 — fixture 사례에는 없다 |
| `motif.approximate_match` | 근사 매칭(`motif grounded only approximately`) 발생 여부. 관측치가 실어온 값이며, 검색이 정확 일치를 못 찾았음을 뜻한다 |
| `size_mm`, `placement`, `drop` | 최종 intent의 크기·배치 종류·엇갈림 비율 |
| `positions`, `centers`, `rotation` | 실제 `place()` 결과. positions는 회전을 포함하고 centers는 좌표만 비교 |
| `count`, `count_fulfilled` | 경계 clone을 제외한 실제 인스턴스 수. 요청 count 대신 반환 개수를 검사 |
| `density` | 실제 인스턴스 수 / tile_mm². 타일 확장으로 개수만 증가한 것을 밀도 증가로 오판하지 않음 |
| `appearance` | 크기·실제 위치/회전·opacity·모티프끼리의 그리기 순서. 무관한 레이어 번호 재정렬은 허용 |
| `normalized_positions`, `relative_size` | 좌표·크기를 tile_mm으로 나눔. 전역 배율 변경의 비율 보존 검사 |
| `lane`, `stripe_host` | 실제 존재하는 stripe host와 정규화된 lane 연결. 중심선 연결만 검증 |
| `lane_contains_shape` | 회전 반영 AABB 전체가 lane이 가리키는 띠 안에 들어가는지. `b{i}.center`는 밴드, `b{i}.gap`은 빈 공간이 기준이며 경계 clone도 함께 본다. 중심만 사이에 있는 것과 도형 전체가 들어간 것을 가르는 조건이다. 시작/끝 lane은 면적이 없어 이 사실을 내지 않음 |
| `self_overlaps`, `motif.overlaps` | 경계 clone까지 포함한 인스턴스 쌍 중 회전 반영 AABB가 겹치는 수(레이어 내부 / 전체). **AABB는 과대추정**이라 0은 비겹침 증명이지만 양수는 후보 쌍일 뿐이다. 실측(2026-09-09, 산개 두 슬롯): AABB 후보 79쌍 중 실제 잉크 겹침은 52쌍으로 **오탐 34%**. 명세가 격자에서 15%까지의 겹침을 허용하므로 이 값은 진단이며, 겹침 0을 요구하는 조건은 사례가 명시할 때만 쓴다 |
| `self_ink_overlaps`, `motif.ink_overlaps` | `--ink-overlap`을 준 실행에서만 나오는 2단계 판정. AABB가 겹친 쌍만 알파 마스크로 다시 본다(해상도 8px/mm, 알파 임계 16, 안전 여백 없음). 렌더러(rsvg-convert/resvg)가 필요하다. 저해상도라 **비겹침의 증명이 아니다** — 가는 선은 놓칠 수 있다. 플래그 없이 돌리면 이 사실 자체가 없으므로 이 값을 쓰는 조건은 조용히 통과하지 않고 실패한다 |
| `rejection` | 저장된 거절 이유와 기대 이유 일치. 과금 환불·턴 삭제는 별도 API 테스트의 책임 |

```bash
uv run python apps/worker/scripts/eval_design_accuracy.py --outputs obs.json --ink-overlap
```

`compose_design`이 반환한 정규화 intent를 사용한다. 따라서 validator repair 이후를 검사한다.
관측 입력은 worker가 제약 적용까지 마친 **최종 resolved intent**여야 한다. 저작 Plan이나 적용 전 patch를 그대로 입력하지 않는다.
평가기가 production 전처리를 전부 재실행하는 것은 아니므로 제공된 입력이 실제 최종 산출물인지 수집 단계에서 보장한다.
geometry 충돌·seam·미적 균형·물리 색 재현은 별도 평가 대상으로 남는다.

## 실행과 입력

코퍼스의 ID·baseline·조건 이름·fixture SVG 합성이 유효한지 무료로 확인한다.

```bash
uv run python apps/worker/scripts/eval_design_accuracy.py --check-corpus
```

실모델 출력은 수집 스크립트로 모은다(유료, 동의 필요). 편집 사례는 코퍼스 fixture를 baseline으로 쓰고,
fixture 모티프의 subject는 프로덕션이 DB에서 읽는 값을 스크립트 상수로 공급한다.

```bash
uv run python apps/worker/scripts/collect_design_accuracy.py --confirm-live --out obs.json --meta meta.json
```

간헐적 실패는 1회 실행으로 보이지 않는다. `--repeat N`은 같은 사례를 N회 돌려 `obs.1.json`…처럼
회차별 파일로 남기고, 사례별 성공률은 회차마다 채점해서 센다.

```bash
uv run python apps/worker/scripts/collect_design_accuracy.py --confirm-live --repeat 10 --case accuracy-013 --out obs.json --meta meta.json
```

실제 저장 결과는 JSON 배열로 준비하고 다음 명령으로 채점한다.

```bash
uv run python apps/worker/scripts/eval_design_accuracy.py --outputs /private/tmp/design-observations.json
```

각 배열 원소는 다음 필드를 사용한다.

| 필드 | 내용 |
|---|---|
| `case_id` | 코퍼스의 사례 ID (체인 턴은 코퍼스 순서대로 수집해야 baseline이 채워진다) |
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

2026-09-09 첫 실모델 기준선(v1, 27/30)과 기준 확정 후 재측정(v3, 30/30 2회)은
[실행 기록](../reviews/design-accuracy-baseline-2026-09-09.md)에 있다.
v1 실패 3건이 전부 기준 쪽 문제였고, 사람 확정을 거쳐 문장·조건을 고친 것이 현재의
`design-accuracy-v3`(`review_status=reviewed`)다.
**revision이 다른 수치를 같은 지표로 비교하지 않는다** — 기준이 달라졌다.

원자 조건과 의존 관계 설계는 [T2I-CompBench](https://arxiv.org/abs/2307.06350)와
[DSG](https://arxiv.org/abs/2310.18235)를 참고했다(2026-09-08 조사). 여기서는 이미지 질문응답 대신 intent·좌표를 직접 판정한다.
