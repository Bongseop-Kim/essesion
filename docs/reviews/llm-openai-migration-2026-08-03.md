# LLM/임베딩 OpenAI 전환 실행 기록 (2026-08-03)

`docs/plans/llm-openai-migration.md` 실행 완료. Gemini/Vertex 경로 전부 삭제.

- 생성: `gemini-2.5-flash-lite` → `gpt-5.6-luna` (`adapters/llm.py`, httpx 직접 호출,
  strict json_schema). 임베딩: `gemini-embedding-001`(3072) →
  `text-embedding-3-large` dimensions=1536 (`adapters/embedding.py`). `google-genai` 의존성,
  `roles/aiplatform.user` IAM, worker의 `gcp_project_id`/`vertex_ai_location` 설정 제거.
- DB: 리비전 `6dbb8bb66939` — `embedding_vertex(3072)` → `embedding_openai(1536)`,
  halfvec expression HNSW → 컬럼 직접 HNSW(`vector_cosine_ops`). `task_type` 개념 삭제.
- 플랜과 다르게 처리한 것:
  - `authoring_promotion_candidates.reviewable_ready` 제약에서 **approved 제외** —
    approved는 terminal이라 임베딩 모델 이관 시 벡터가 무효화(NULL)돼도 감사 기록을
    보존해야 한다. pending/hold 후보는 마이그레이션이 삭제(원본 로그가 다시 스캔
    가능해져 다음 scan이 새 임베딩으로 재생성).
  - 개인정보처리방침(store)의 국외 처리 목록에서 Gemini 항목 제거. 후속 코드 리뷰에서
    실제 전송 항목과 OpenAI·Recraft 공개 정책에 맞춰 문구를 정정했으며, Recraft 계정의
    모델 학습 opt-out/DPA·보존기간은 **privacy owner와 법률 검토자 확인이 남았다**.

## 리스크 검증 결과

1. **τ 재캘리브레이션**: text-embedding-3-large 분포에서 정답 top-1 0.445~0.608(10/10 정답),
   무관 쿼리 ≤0.339 → `motif_similarity_tau` 0.84 → **0.40**. 승격 semantic dup
   임계값(0.95)은 미조정 — 새 분포에서 더 보수적으로 동작하며 관리자 검토가 최종 게이트.
2. **strict 스키마**: 최초 전환의 DesignPlanV3(풀/variant 제거)·DesignPatchV1 실호출 3건
   전부 통과 — `strict:false` 폴백 불필요. 2026-08-04 후속 리뷰에서 OpenAI가 지원하는
   수치·배열 바운드를 constrained schema에 복원했으며 단위 테스트는 통과했다. 변경 후
   live 30건 재평가는 `OPENAI_API_KEY`·`DATABASE_URL`이 있는 환경에서 실행해야 한다.
3. **캡스톤 eval** (`eval_authoring.py --confirm-live`, corpus 30): compile 성공률
   **30/30(100%)**, 평균 저작 시도 1.27, p95 지연 19.7s, retrieval ok 30/30,
   expected family recall 0.83. prompt revision `…-openai-v1`으로 상승.
4. **로컬 리셋 E2E**: `down -v` → upgrade → 시드 전체 → 재임베딩(97/97 motif,
   25/25 example active 복구) → store에서 프롬프트 생성(꿀벌 grounding 성공)·구성
   patch·아이디어 4건, 콘솔 오류 0.

## 후속 코드 리뷰 보완 (2026-08-04)

- OpenAI LLM·embedding·Recraft의 HTTP 오류와 refusal에서 provider 응답 원문을 제거하고,
  가짜 secret이 예외 문자열·traceback에 남지 않는 회귀 검증을 추가했다.
- OpenAI strict schema가 지원하는 수치·배열 바운드를 constrained decoding에 복원하고
  중복 count-limit prompt를 삭제했다. DB와 고정된 1536차원을 운영 설정에서 제거했다.
- 개인정보처리방침의 실제 전송 항목·Recraft 공개 정책·시행일과 활성 DB/운영 문서를
  현재 구현에 맞췄다. 법률·계약 확인과 변경 schema의 live eval은 아래 배포 전 작업이다.
- 자동 검증: Python `1195 passed`, JS lint/typecheck/test/build, Ruff, Pyright,
  `uv lock --check`, OpenAPI drift 0. live eval은 셸에 `OPENAI_API_KEY`·`DATABASE_URL`이
  없어 실행하지 않았다(`.env`는 정책상 읽지 않음).

## 배포 전 남은 운영 작업

- Secret Manager에 `openai-api-key` 값 주입(infra/README.md 절차) 후 tofu apply —
  컨테이너가 시크릿 버전 없이 기동하면 실패한다.
- 스테이징/운영 DB migrate 후 `index_motif_embeddings.py --confirm-live` →
  `seed_authoring_examples.py --confirm-live` 재임베딩 실행.
- 수치·배열 바운드를 복원한 strict schema로 `eval_authoring.py --confirm-live` 30건 재평가.
- OpenAI·Recraft 국외 처리 문구, Recraft 모델 학습 opt-out 또는 별도 DPA와 보존기간을
  privacy owner·법률 검토자가 승인.
