# Authoring Plan v3 저작·운영·승격 계약

관리자 UI는 생성 결과의 근거와 승격 후보를 검토하고, RAG 시범의 활성 상태를 관리한다.
admin은 별도로 intent와 Plan v3를 직접 작성하고 실제 타일을 확인한 뒤 운영 DB에 저장할
수 있다. manager는 모든 시범과 이력을 읽기만 한다.

## 저작 계약과 런타임 정본

- provider 계약: `worker.authoring.schema.DesignPlansV3` (`plan_contract_version=3`)
- compiler: `worker.authoring.compiler` (`compiler_revision=design-plan-v3.0`)
- prompt: `design-plan-v3-rag-grounded`; Pydantic 모델을 Vertex `response_schema`로 전달
- starter 입력: `apps/worker/src/worker/authoring/data/gallery-v1.json`
- compiler 회귀 픽스처: `apps/worker/tests/golden/json/*.json`
- 런타임 정본: `authoring_examples`에서 `active=true`이고 현재 contract·embedding model과
  일치하는 행

운영 셋 전체의 원천은 DB다. `source`는 빈 DB에 넣은 `bootstrap`, 관리자 UI에서 만든
`authored`, 생성 결과를 승인한 `promoted`를 구분한다. git의 `gallery-v1`은 소량 starter일
뿐 운영 셋의 revision이나 골든 목록이 아니며 embedding도 보관하지 않는다. compiler
byte-identical 회귀는 시드 manifest 필드가 아니라 테스트 픽스처의 ID-파일명 규약으로
독립 검증한다.

아래 명령은 starter 중 없는 ID만 insert하고 현재 모델 행의 누락 embedding만 채운다.
같은 `example_id`가 이미 있으면 Plan, intent, 기존 embedding과 관리자의 활성 결정을
덮어쓰지 않는다. 활성 변경 이력이 없는 bootstrap 행은 첫 embedding이 완성될 때
활성화하지만, 관리자가 활성 상태를 한 번 바꾼 행은 재실행해도 그 결정을 보존한다.

```bash
uv run python apps/worker/scripts/seed_authoring_examples.py --confirm-live
```

정상 출력은 `seeded <신규> examples`와
`embedded=<전체>/<전체> source=bootstrap`을 함께 보여 준다. starter 항목 수는 계약이
아니며 ID만 유일하면 된다.

Plan에는 normalized ratio와 제한된 enum/template만 둔다. engine layer ID, motif
content-hash ID, mm, SVG와 임의 좌표는 compiler 뒤에만 존재한다. fixed palette,
exact/private motif, 사진 purpose와 catalog grounding은 compiler와 최종 engine validation이
다시 강제한다.

## 생성 데이터 승격 후보

Cloud Scheduler가 매일 05:00 KST에
`POST /batch/authoring-promotion-candidates`를 호출한다. API는 generate worker의
`POST /authoring/promotions/scan`으로 최대 100건을 전달하며 embedding 동시성은 4다.

후보는 다음 조건을 모두 만족한 최신 generation에서만 만든다.

1. generation log가 `success`이고 prompt와 authoring Plan을 보존한다.
2. 현재 Plan contract와 compiler revision으로 다시 검증된다.
3. 사용자가 해당 generation의 후보를 선택했다.
4. 다음 재생성 요청 전 같은 세션에서 finalize가 성공했다.

후보 retrieval document에는 원래 prompt, family와 구조 tag만 넣는다. SVG, 이미지,
resolved motif와 engine intent는 예시에 복제하지 않는다. 잘못된 계약은 `invalid`, 이미
겹치는 결과는 `duplicate`, 검토 가능한 결과는 `pending`으로 기록한다. embedding provider
실패 건은 DB에 반쪽 후보로 남기지 않고 다음 배치에서 재시도한다.

중복 판정은 다음 두 단계를 사용한다.

1. active 예시 및 `pending|hold` 후보와 structural fingerprint가 같으면 즉시 중복
2. 같은 family·motif count·embedding model에서 cosine similarity가 `0.95` 이상이면 중복

같은 배치에서 먼저 저장된 후보도 뒤 후보의 중복 비교 대상이다. `inactive`, `rejected`,
`duplicate`, `invalid` 행은 새 후보를 막지 않는다.

## 관리자 직접 저작

`/authoring-examples`의 활성 시범 탭에서 admin은 다음 흐름으로 `authored` 시범을 만든다.

1. 검색 intent와 `DesignPlanV3` JSON을 입력한다.
2. 필요하면 기존 관리자 motif API에서 카탈로그 motif를 최대 2개 골라 `input_index`
   순서에 연결한다.
3. worker의 `POST /authoring/compile-preview`가 Plan을 compile하고 기존 renderer로 SVG를
   만든다. 이 경로는 Gemini, Recraft, embedding을 호출하지 않는다. 카탈로그에 없는
   motif나 생성이 필요한 source의 layer는 경고와 함께 제외한다.
4. 현재 입력으로 성공한 프리뷰가 있어야 저장할 수 있다.
5. 저장 시 worker가 Plan을 `DesignPlanV3`로 검증하고 family, tags, fingerprint와 digest를
   공용 helper로 산출한 뒤 현재 모델의 document embedding을 한 번 만든다. 새 행은
   `source=authored`, `active=false`다.

authored 시범만 optimistic timestamp와 함께 intent/Plan을 편집하거나 hard delete할 수
있다. 편집할 때 구조 메타데이터와 embedding을 현재 모델로 다시 만든다.
bootstrap/promoted 시범은 본문 편집과 삭제를 거부하고 활성 토글만 허용한다.

## 관리자 승격 검토와 즉시 반영

관리자 화면의 `/authoring-examples`에서 승격 후보와 활성 시범을 함께 조회한다.

- `pending → hold|reject|approve`
- `hold → reject|approve`
- `reject`는 terminal 상태
- 모든 결정은 사유, 관리자, 시각과 optimistic version을 기록하며 operation ID로 멱등 처리

승인 직전 worker가 현재 embedding model을 확인하고 누락되거나 오래된 candidate embedding을
다시 만든다. API는 transaction lock 안에서 active 시범과 exact/semantic 중복을 다시 확인한
뒤 promoted 시범을 `active=true`로 생성한다. 별도 revision 생성이나 후속 seed를 기다리지
않으며 commit 직후 다음 RAG 검색부터 대상이 된다.

문제가 있는 활성 시범은 상세 화면에서 사유와 함께 `active=false`로 즉시 제외한다.
재활성화할 때는 네트워크 embedding 호출 없이 worker의 현재 모델명을 확인하고
contract·vector·embedding model·검증 시각과 active 집합 중복을 다시 검사한다.
후보 상세는 원 generation 링크, 안전하게 sanitize된 선택 SVG preview, 원래 prompt,
Plan/fingerprint/compiler/prompt revision을 제공한다. embedding vector 원문은 API로 내보내지
않는다.

## RAG 선택 계약

query document는 사용자 prompt, 사용 가능한 motif slot 수와 pattern constraint를 순서대로
합친다. Vertex `RETRIEVAL_QUERY` embedding으로 현재 contract·embedding model의 active
시범만 cosine top-25로 읽고 다음 순서로 줄인다.

1. motif 수와 명시 arrangement에 맞지 않거나 Plan v3로 재검증되지 않는 행 제외
2. 상위 8개만 후보로 유지
3. 서로 다른 family를 먼저 뽑고 부족할 때 rank 순으로 보충
4. 최대 3개의 normalized Plan만 prompt에 포함

embedding/DB 오류나 빈 active 집합은 상태 코드만 진단에 남기고 few-shot 없이 typed schema
경로를 계속한다. provider에게 golden engine JSON, 내부 motif ID, SVG 또는 embedding을
보내지 않는다.

## 런타임 경로

모든 요청은 Plan v3 계약과 compiler를 사용한다. 별도 mode, 비율, cohort, shadow 실행이나
이전 저작 경로 fallback은 없다. 배포 전 평가에서 기준을 만족하지 못하면 코드를 수정한 뒤
다시 검증하며, 실행 중 설정으로 이전 구현을 되살리지 않는다.

## 평가와 추적

실제 provider 평가 호출은 명시적 동의와 ADC/DB가 있을 때만 실행한다.

```bash
uv run python apps/worker/scripts/eval_authoring.py \
  --confirm-live
```

평가는 schema/compiler 성공률, 구조 다양성, 유효·고유 구조 수, retrieval family recall,
재시도, 평균/p95 latency와 안전한 실패 분류를 보고한다. generation diagnostics에는 model,
prompt/contract/compiler revision, retrieval 상태와 선택 example
ID/family/similarity, 구조 fingerprint와 오류 유형을 남긴다. prompt나 provider 응답 원문은
평가 보고서에 복제하지 않는다.
