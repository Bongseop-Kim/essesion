# Authoring Plan v3 운영·승격 계약

관리자 UI는 prompt와 Plan 본문을 편집하지 않는다. 개발자와 관리자는 생성 결과의 근거를
추적하고, RAG 예시 후보를 검토하며, 승인된 예시의 활성 상태와 파이프라인 rollout만
관리한다.

## 저작 계약과 런타임 정본

- provider 계약: `worker.authoring.schema.DesignPlansV3` (`plan_contract_version=3`)
- compiler: `worker.authoring.compiler` (`compiler_revision=design-plan-v3.0`)
- prompt: `design-plan-v3-rag-grounded`; Pydantic 모델을 Vertex `response_schema`로 전달
- bootstrap 입력: `apps/worker/src/worker/authoring/data/gallery-v1.json`
- 원본 대조 자료: `apps/worker/tests/golden/json/*.json`
- 런타임 정본: `authoring_examples`에서 `active=true`이고 현재 contract·embedding model과
  일치하는 행

bootstrap 파일은 최초의 승인 예시를 만드는 입력일 뿐 revision이나 런타임 검색 조건이
아니다. 새 스키마 적용 시 기존 revision 기반 로컬 테이블은 보존하지 않고 다시 만든다.
아래 명령은 bootstrap 예시를 멱등 투영하고 누락 embedding을 생성한다. 처음 embedding이
완성된 예시는 승인·활성 상태가 되지만, 관리자가 한 번 활성 상태를 바꾼 뒤에는 sync가 그
결정을 덮어쓰지 않는다.

```bash
uv run python apps/worker/scripts/build_authoring_examples.py --check
uv run python apps/worker/scripts/sync_authoring_examples.py --confirm-live
```

정상 출력은 `embedded=<전체>/<전체> source=bootstrap`이다. 같은 `example_id`의 Plan,
retrieval text, fingerprint 등 불변 내용이 달라졌다면 sync는 실패한다.

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

## 관리자 검토와 즉시 반영

관리자 화면의 `/authoring-examples`에서 후보와 승인 예시를 조회한다. manager는 읽기만
가능하고 admin만 상태를 바꿀 수 있다.

- `pending → hold|reject|approve`
- `hold → reject|approve`
- `reject`는 terminal 상태
- 모든 결정은 사유, 관리자, 시각과 optimistic version을 기록하며 operation ID로 멱등 처리

승인 직전 worker가 현재 embedding model을 확인하고 누락되거나 오래된 embedding을 다시
만든다. API는 transaction lock 안에서 active 예시와 exact/semantic 중복을 다시 확인한 뒤
승인 예시를 `active=true`로 생성한다. 별도 revision 생성이나 후속 sync를 기다리지 않으며
commit 직후 다음 RAG 검색부터 대상이 된다.

문제가 있는 승인 예시는 상세 화면에서 사유와 함께 `active=false`로 즉시 제외한다.
재활성화할 때는 현재 contract·embedding 준비 상태와 active 집합 중복을 다시 검사한다.
후보 상세는 원 generation 링크, 안전하게 sanitize된 선택 SVG preview, 원래 prompt,
Plan/fingerprint/compiler/prompt revision을 제공한다. embedding vector 원문은 API로 내보내지
않는다.

## RAG 선택 계약

query document는 사용자 prompt, 사용 가능한 motif slot 수와 pattern constraint를 순서대로
합친다. Vertex `RETRIEVAL_QUERY` embedding으로 현재 contract·embedding model의 active
예시만 cosine top-25로 읽고 다음 순서로 줄인다.

1. motif 수와 명시 arrangement에 맞지 않거나 Plan v3로 재검증되지 않는 행 제외
2. 상위 8개만 후보로 유지
3. 서로 다른 family를 먼저 뽑고 부족할 때 rank 순으로 보충
4. 최대 3개의 normalized Plan만 prompt에 포함

embedding/DB 오류나 빈 active 집합은 상태 코드만 진단에 남기고 few-shot 없이 typed schema
경로를 계속한다. provider에게 golden engine JSON, 내부 motif ID, SVG 또는 embedding을
보내지 않는다.

## Rollout 설정과 롤백

`authoring_pipeline_mode`, `authoring_shadow_percent`, `authoring_canary_percent`는
`admin_settings`와 기존 관리자 설정 화면에서 관리한다. 환경 변수는 사용하지 않는다.
허용 mode는 `legacy|shadow|canary|v3`, percent 범위는 `0..100`이다. 키가 없거나 값이
잘못되면 요청을 실패시키지 않고 `legacy`로 닫히며 진단에 원인을 남긴다.

권장 순서는 `legacy → shadow 5% → shadow 100% → canary 5~10% → canary 확대 → v3`다.
cohort는 request ID SHA-256 bucket이라 같은 ID에서 안정적이다. shadow는 사용자 응답을
legacy가 결정하고 제한 시간 안의 v3 결과는 진단만 남긴다. canary/v3는 숨은 legacy
fallback을 두지 않는다. 즉시 롤백은 관리자 설정에서 mode를 `legacy`로 바꾸는 것이다.

## 평가와 추적

실제 provider 평가 호출은 명시적 동의와 ADC/DB가 있을 때만 실행한다.

```bash
uv run python apps/worker/scripts/eval_authoring.py \
  --confirm-live --pipeline legacy --pipeline v3
```

평가는 schema/compiler 성공률, 구조 다양성, 유효·고유 구조 수, retrieval family recall,
재시도, 평균/p95 latency와 안전한 실패 분류를 보고한다. generation diagnostics에는 pipeline
mode/cohort, model, prompt/contract/compiler revision, retrieval 상태와 선택 example
ID/family/similarity, 구조 fingerprint와 오류 유형을 남긴다. prompt나 provider 응답 원문은
평가 보고서에 복제하지 않는다.
