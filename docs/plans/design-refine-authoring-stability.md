# 대화형 수정(refine) 저작 안정화 플랜

> 2026-07-29 A1–A5 재검증에서 색상 요청 미반영(A2 ×2), 간격 변경 거부 후 구조 손실(A3), 스트라이프 추가 전멸(A5 ×3, 내부 12 attempts)이 발생했다. 원인 진단은 `docs/reviews/design-text-prompt-manual-test-2026-07-29.md`의 "재검증 1차 실행 결과와 저작 실패 원인 진단" 참조. 공통 뿌리는 refine이 flash-lite에게 전체 plan 재저작을 맡기면서 결정론적으로 처리 가능한 것(격자 보정·히스토리 절제·색 반영 검증·오류문 번역)까지 모델 운에 맡기는 구조다. 아래 순서대로 적용한다 — 1·2가 실패의 대부분을 제거하고 3·4는 남은 품질 구멍을 막는다.

## 1. lattice half-drop 짝수 보정 (A3 계열 소멸)

- 근거: 엔진은 drop 사용 시 drop축 개수 짝수를 요구하지만(`engine/validate.py`의 torus closure) `DesignPlanV3` 스키마는 이를 표현하지 못해, 모델이 홀수 열·행을 뽑으면 4회 재시도 전멸로 이어진다. 컴파일러의 wave wavelength snap과 같은 결의 문제다.
- 변경: `authoring/schema.py`의 `LatticePlacementPlan`에 `model_validator(mode="after")`를 추가해 `drop != "none"`이면 drop축 개수(half_column→columns, half_row→rows)를 `n += n % 2`로 올림 보정한다. 스키마에서 보정하면 저작 응답·병합 결과·커밋 스냅샷이 모두 일관되고 엔진까지 도달할 일이 없다(컴파일러 보정 대안보다 이 점이 낫다).
- 주의: 상한 16은 15→16으로 안전. 보정은 `normalize_hex`처럼 조용한 정규화로 취급하고 거부하지 않는다.

## 2. refine 프롬프트의 대화 히스토리 절제 (A5 계열의 방아쇠 제거)

- 근거: 동일 커밋 플랜·동일 프롬프트에서 히스토리 없이는 2/2 유효, 히스토리 5건 포함 시 colors 배열 따옴표 붕괴·밴드 커버리지 초과 등 constrained decoding이 즉시 무너지는 것을 라이브 재현으로 확인했다. refine에서는 `<current_design>`이 정본이라 히스토리의 정보 기여가 낮다.
- 변경: `adapters/gemini.py` `_build_prompt`에서 refine(`current_plan is not None`)일 때 히스토리를 최근 2건으로 자른다(현행 `[-6:]` → `[-2:]`). API 쪽 계약(`max_length=6`)은 그대로 둔다.
- 판단 기준: 적용 후에도 A5류(레이어 추가 요청) 실패가 재현되면 refine에서 히스토리를 아예 제외하고, 그래도 남으면 refine 한정 모델 상향(gemini-2.5-flash) 또는 temperature 하향을 검토한다. 무측정 승격은 하지 않는다.

## 3. 색상 요청의 의미 검증 (A2 계열 차단)

- 근거: `_ensure_requested_refine_changes`는 "colors가 뭐라도 바뀌었나"만 검사해, 모델이 기존 팔레트에서 ground 인덱스만 셔플해도 통과한다. 오늘 버건디 요청 4회 중 3회가 이 패턴이었다.
- 변경 (a): colors 권한이 열렸는데 `set(evolved.colors) == set(current.colors)`이면 순열로 간주해 `missing`에 "colors"를 추가한다 — 재시도 피드백은 "recoloring must introduce new hex values, not permute the existing palette" 계열의 한 줄로. 알려진 한계: "배경색과 모티프 색을 서로 바꿔줘" 같은 스왑 요청이 위양성이 된다. 드문 케이스로 보고 기록만 하되, 문제가 되면 색이름→hex 계열 룩업(버건디→`#722F37` 근방 등)으로 "요청한 계열이 팔레트에 존재하는가" 검증으로 상향한다.
- 변경 (b): `_COLOR_WORDS`에 누락 색이름을 보강한다 — 버건디, 아이보리, 와인, 마룬, 금색, 은색, 골드, 실버, 카키, 올리브, 민트, 크림, 차콜, burgundy, ivory, wine, maroon, gold, silver, khaki, olive, mint, cream, charcoal. 현재는 "배경은 버건디로 바꿔줘"처럼 색이름만 쓰면 색 변경 권한이 열리지 않아 팔레트가 통째로 복원된다.

## 4. 재시도 오류 피드백을 plan 필드 언어로 번역

- 근거: 현재 피드백은 pydantic 원문 덤프(수백 자 input_value 포함)나 엔진 좌표계 용어(tile/cell/drop_fraction — plan에 없는 필드)라서 flash-lite가 교정하지 못하고 같은 실패를 반복한다. 실측: A3 1회분 4 attempts, A5 3회분 12 attempts 전멸.
- 변경: `author_designs`의 `f"model response did not match {contract}: {exc}"`를 `exc.errors()`의 `loc`+`msg` 요약(입력값 덤프 제거)으로 바꾸고, 자주 나오는 검증 실패에 plan 필드 언어 힌트를 붙이는 소형 번역 테이블을 둔다. 예: motif 사용 규칙 → "keep the existing motif layer in layers and add the new stripe layers alongside it". 1번 적용 후 torus 오류는 소멸하므로 테이블은 실제 로그에 나오는 항목만 담는다.

## 검증

- 단위: 홀수 columns+half_column plan이 짝수로 보정돼 `validate_intent`를 통과하는 테스트, 팔레트 순열 응답이 "colors" missing으로 거부되는 테스트, `_COLOR_WORDS` 신규 색이름의 권한 개폐 테스트.
- 재현 측정: 진단에 사용한 조건(A4 커밋 플랜 + A5 프롬프트, 히스토리 포함/절제)으로 각 10회 이상 호출해 파싱 실패율을 전후 비교한다. Vertex ADC 필요 — `--confirm-live` 관례를 따른다.
- 수동: `docs/plans/design-text-prompt-manual-test.md`의 A1–A5를 처음부터 재실행하고 결과를 리뷰 문서에 기록한다.

## 상태 — 계획
