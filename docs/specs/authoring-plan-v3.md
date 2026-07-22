# Authoring Plan v3 운영·업그레이드 계약

관리자 UI에서 prompt나 설정을 편집하는 기능은 범위 밖이다. 이 파이프라인은 개발자가 Git diff, 고정 revision, 평가 결과와 generation trace로 검토하고 승격한다.

## 정본과 경계

- provider 계약: `worker.authoring.schema.DesignPlansV3` (`plan_contract_version=3`)
- compiler: `worker.authoring.compiler` (`compiler_revision=design-plan-v3.0`)
- prompt: `design-plan-v3-rag-grounded`; Pydantic 타입을 Vertex `response_schema`로 직접 전달
- 예시 정본: `apps/worker/src/worker/authoring/data/gallery-v1.json`
- 원본 대조 자료: `apps/worker/tests/golden/json/*.json`; manifest는 각 파일의 SHA-256을 보존
- 운영 projection: `authoring_examples`; `(example_set_revision, example_id)`는 immutable이며 Git 정본을 런타임에서 수정하지 않음

Plan에는 normalized ratio와 제한된 enum/template만 둔다. engine layer ID, motif content-hash ID, mm, SVG, 임의 point 좌표는 compiler 뒤에만 존재한다. fixed palette, exact/private motif, 사진 purpose, catalog grounding은 compiler와 최종 engine validation이 다시 강제한다.

## 예시 변경 절차

1. 기존 revision을 덮어쓰지 말고 새 revision 이름과 data file을 만든다.
2. test golden을 검토한 뒤 build script의 변환 규칙/설명을 갱신한다. 현재 revision 확인:

   ```bash
   uv run python apps/worker/scripts/build_authoring_examples.py --check
   ```

3. 25개 plan 전체가 strict schema와 compiler/engine validation을 통과하고 family/placement coverage가 유지되는지 테스트한다.
4. Alembic 적용 뒤 대상 환경에서 projection과 `RETRIEVAL_DOCUMENT` embedding을 생성한다:

   ```bash
   uv run python apps/worker/scripts/sync_authoring_examples.py --confirm-live
   ```

5. 출력이 `embedded=25/25 set=<revision>`인지 확인한다. 같은 revision/ID의 digest·contract·embedding model이 달라지면 sync는 실패해야 정상이다.

새 revision을 지원할 때는 loader가 revision별 manifest를 명시적으로 선택하도록 먼저 확장한다. DB 행만 수동 추가하거나 기존 revision을 UPDATE하지 않는다.

## RAG 선택 계약

query 문서는 사용자 prompt, 사용 가능한 motif slot 수, pattern constraint를 순서대로 합친다. Vertex `RETRIEVAL_QUERY` embedding으로 같은 contract/revision/model의 cosine top-25를 읽고 다음 순서로 줄인다.

1. motif 수와 명시 arrangement에 맞지 않거나 Plan v3로 재검증되지 않는 행 제외
2. 상위 8개만 후보로 유지
3. 서로 다른 family를 먼저 뽑고 부족할 때 rank 순으로 보충
4. 최대 3개를 normalized plan으로만 prompt에 포함

embedding 미구성/오류, DB 오류, 빈 revision은 상태 코드만 진단에 남기고 few-shot 없이 v3 schema 호출을 계속한다. provider에게 golden engine JSON, 내부 motif ID 또는 SVG를 보내지 않는다.

## 배포와 롤백

배포 설정은 `worker_generate_extra_env`로만 바꾼다.

```hcl
worker_generate_extra_env = {
  AUTHORING_PIPELINE_MODE         = "shadow"
  AUTHORING_SHADOW_PERCENT        = "5"
  AUTHORING_CANARY_PERCENT        = "10"
  AUTHORING_EXAMPLE_SET_REVISION  = "gallery-v1"
}
```

권장 순서는 `legacy → shadow 5% → shadow 100% → canary 5~10% → canary 확대 → v3`다. cohort는 request ID SHA-256 bucket이라 같은 ID에서 안정적이다. shadow는 legacy와 v3를 병렬 실행하되 v3를 30초로 제한하고 폐기한다. canary/v3는 숨은 legacy fallback을 두지 않아 실제 실패율을 관측할 수 있다. 즉시 롤백은 mode를 `legacy`로 되돌리는 것이며 DB projection과 v2 코드는 그대로 유지한다.

## 평가와 추적

실제 호출은 명시적 동의와 ADC/DB가 있을 때만 실행한다.

```bash
uv run python apps/worker/scripts/eval_authoring.py \
  --confirm-live --pipeline legacy --pipeline v3
```

30개 case는 ID, prompt, motif 수, expected family label을 가진다. 보고 지표는 schema/compiler 성공률, 2개 이상 구조 다양성 통과율, 유효/고유 구조 수, retrieval expected-family recall, 재시도, 평균/p95 latency와 안전한 실패 분류다. prompt와 provider 응답 원문은 보고서나 DB diagnostics에 복제하지 않는다.

각 generation에는 pipeline mode/cohort, model, prompt/contract/compiler/example revision, retrieval status/reason/time, 선택 example ID/family/similarity, plan 수, 유효 수, duplicate 수와 structural fingerprint를 남긴다. v3의 normalized plan은 기존 관리자용 safe diagnostics가 아니라 generation intent log의 authoring block에 보존한다. 별도 관리자 설정/편집 화면은 만들지 않는다.
