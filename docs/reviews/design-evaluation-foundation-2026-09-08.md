# 디자인 평가 기준 기반 — 2026-09-08

엔진 정확도 플랜(2026-09-09 [실행 완료](./design-engine-accuracy-2026-09-09.md), 남은 항목은 [후속 플랜](../plans/design-accuracy-followups.md))의 평가 기반을 구현했다.
생성 엔진·provider·과금 경로는 변경하지 않았다. 사람이 검토하기 전인 기준 초안이며 실모델 평가는 미실행이다.

## 결과

- [기준 코퍼스](../../apps/worker/scripts/design_accuracy_cases.json): 한국어 30건, 첫 생성 8·편집 18·거절 4.
  원·별 symbol과 baseline 5개를 고정했다. 20건 regression·10건 held-out 구분은 향후 예시 사용 제한용이며 RAG 누출 검증 완료를 뜻하지 않는다.
- [오프라인 채점기](../../apps/worker/scripts/eval_design_accuracy.py): 실제 colorway, 정규화 intent,
  배치 좌표·수량·면적당 밀도, 비대상 모티프 보존, stripe host/lane, 거절 이유를 검사한다.
  조건별·모드별·분할별 건수와 코퍼스 hash를 출력하고 누락·잘못된 결과를 분모에서 제외하지 않는다.
- [평가 명세](../api-spec/design-evaluation.md): 실행 명령, 입력 JSON, 비교 허용오차, 통과 정의와 측정 한계를 기록했다.
  기존 live authoring 도구는 유지하고 문서에서 두 평가의 목적을 연결했다.

## 검증

- `uv run pytest apps/worker/tests/test_design_accuracy.py apps/worker/tests/test_authoring_eval.py`: **7개 테스트 통과**.
  수작업으로 지정한 후보 30건의 충족 가능성과 색 역할 뒤바뀜·모티프 누락/투명화·잘못된 lane·비대상 수정·이전 회전 유실·수량 부족·잘못된 거절·입력 오류를 검사한다.
- 30→22 산개 입력을 직접 재현했으며 요청 개수 대신 실제 개수를 채점한다.
- 줄무늬 제거에 따른 z_order 번호 재정렬은 의미 변경이 아니므로 모티프 사이 그리기 순서로 비교한다.
- `--check-corpus`는 provider/DB 없이 fixture 합성과 조건 이름을 검증한다. 모델 평가 여부를 false로 명시한다.
- 변경 Python 파일 Ruff·Pyright와 `pnpm architecture:check` 통과.

## 남은 범위

사람의 기준 검토, 실제 모델 출력 수집·반복 평가, RAG 누출 검사, 모델 출력이 이어지는 대화 평가는 남았다.
전체 도형의 비겹침·줄 침범, 래스터 seam, 시각적 균형은 이 채점기로 보증하지 않는다.
평가 통과율을 모델의 실측 정확도로 보고하지 않는다. 이후의 실모델 측정은 [기준선 기록](./design-accuracy-baseline-2026-09-09.md), 남은 작업은 [후속 플랜](../plans/design-accuracy-followups.md)에 있다.
