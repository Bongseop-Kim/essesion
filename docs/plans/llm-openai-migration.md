# 플랜 — LLM/임베딩을 OpenAI로 교체 (Gemini·Vertex 완전 제거)

> 상태: **미실행 제안** (2026-08-03).
>
> - 생성(저작·패치·아이디어): `gemini-2.5-flash-lite` → **`gpt-5.6-luna`**
> - 임베딩: `gemini-embedding-001`(3072) → **`text-embedding-3-large`, dimensions=1536**
> - Gemini/Vertex 경로는 레거시 없이 전부 삭제. `google-genai` 의존성 제거,
>   `roles/aiplatform.user` IAM 제거. GCS(`google-cloud-storage`)는 무관하므로 유지.

## 확정된 설계 결정

- **SDK 없이 httpx 직접 호출.** recraft 어댑터와 동일 패턴, 신규 의존성 0.
  엔드포인트는 `POST {base_url}/chat/completions`, `POST {base_url}/embeddings` 두 개뿐.
  `openai_base_url` 설정으로 테스트에서 mock transport 주입.
- **구조화 출력은 strict json_schema 유지.** flash-lite에서 constrained decoding이
  grounding에 load-bearing이었음이 실측된 상태(`_servable_json_schema` 주석) — 모델이
  바뀌어도 하드 보장을 버리지 않는다. `response_format={"type":"json_schema","json_schema":
  {"schema":…, "strict":true}}`.
  - 기존 `_servable_json_schema`(Vertex 전용 바운드 제거·oneOf 변환)를
    `_strict_json_schema`로 교체: OpenAI strict 요구사항(모든 property `required`,
    `additionalProperties:false`, optional은 `"null"` 타입 유니온)으로 변환.
  - **variant withholding은 그대로 유지** — 근거 없는 `InputMotifSource`/
    `CatalogMotifSource`를 `$defs`와 union 분기에서 제거하는 로직은 provider 무관하게
    재사용. pydantic 후검증(바운드·조건 필드)도 그대로.
- **컬럼명 `embedding_vertex` → `embedding_openai`**, `EMBEDDING_DIM = 1536`.
- **인덱스 단순화**: 1536 ≤ pgvector 인덱스 dim 한계(2000)이므로 halfvec expression
  HNSW가 불필요 — 컬럼 직접 `hnsw (embedding_openai vector_cosine_ops)`로. store의
  `sql_cast(column, HALFVEC(…))` / `literal_column` 우회도 삭제.
- **`task_type` 개념 삭제.** OpenAI 임베딩에는 없음 — `SupportsEmbed.embed(text)`로
  시그니처 축소, `RETRIEVAL_QUERY/RETRIEVAL_DOCUMENT` 전달부 전부 제거
  (motifs/embeddings.py, authoring/promotion.py, routes.py, seed_authoring_examples.py).
- **temperature 설정 삭제.** gpt-5 계열은 temperature 미지원(기본값 고정) —
  `gemini_temperature` 제거, 대체 노브 없이 시작. 필요해지면 `reasoning_effort`로 재도입.
- provider 문자열: `"gemini"` → `"openai"`, `"vertex_embedding"` → `"openai_embedding"`.

## 작업 항목

### 1. worker 설정 (`apps/worker/src/worker/config.py`)

- 제거: `gcp_project_id`(worker 내 사용처가 두 어댑터뿐 — GCS 클라이언트가 ADC로
  프로젝트를 추론하는지만 실행 시 확인), `vertex_ai_location`, `gemini_model`,
  `gemini_temperature`, `embedding_output_dimensionality`.
- 추가: `openai_api_key: str = ""`(빈값 → 클라이언트 None, 기존 게이팅 의미 유지),
  `openai_base_url: str = "https://api.openai.com/v1"`,
  `llm_model: str = "gpt-5.6-luna"`,
  `embedding_model: str = "text-embedding-3-large"`,
  `embedding_dimensions: int = 1536`.

### 2. 어댑터

- `adapters/gemini.py` **삭제** → `adapters/llm.py` 신규: `LLMClient`(httpx).
  - 프롬프트 빌더(`_build_prompt`/`_build_patch_prompt`/`_build_ideas_prompt`),
    self-correction 루프(저작 4회), `_contract_feedback`, `SemanticMismatch`,
    untrusted 카탈로그 블록·fence 이스케이프는 **그대로 이식**(provider 무관 로직).
  - system instruction은 `messages[0] role="system"`으로.
  - `MAX_OUTPUT_TOKENS` → `max_completion_tokens`.
  - 재시도: {429, 500, 502, 503} 0.5/1/2s 백오프 최대 4회 (기존 정책 + 5xx).
  - `ReferenceImage`/`reference_images` **삭제** — 호출부가 없다(확인 완료).
  - ideas 경로는 `response_format={"type":"json_object"}` + 기존 파싱 루프 유지.
- `adapters/embedding.py` 재작성: `OpenAIEmbeddingClient`(httpx).
  `dimensions=1536` 요청, 응답 차원 검증 유지. `RequestScopedEmbedding` memo 키에서
  task_type 제거. 게이트는 `openai_api_key`.
- `adapters/__init__.py`: `Adapters.gemini` → `Adapters.llm`, build 배선 교체.
- `apps/worker/pyproject.toml`: `google-genai` 제거.

### 3. DB (Alembic — baseline은 main에 있으므로 새 리비전)

대상 3테이블: `motifs`, `authoring_examples`, `authoring_promotion_candidates`.

- halfvec expression HNSW 인덱스 drop → `embedding_vertex` 컬럼 drop →
  `embedding_openai vector(1536)` 추가 → 컬럼 직접 HNSW(`vector_cosine_ops`) 생성.
- **체크 제약 주의**: `authoring_examples`의
  `NOT active OR (embedding IS NOT NULL AND approved_at IS NOT NULL)` —
  컬럼 재생성 전 `active=false`로 내리고 제약을 새 컬럼명으로 재생성.
  `authoring_promotion_candidates`의 `embedding_model↔embedding` 페어 제약도 동일 처리
  (`embedding_model=NULL`로 정리).
- 기존 벡터는 모델이 달라 전부 무효 — 마이그레이션은 null로 두고 재임베딩은 스크립트로
  (아래 §7). downgrade는 역방향 스키마만 복원(데이터 복원 없음).
- `db/src/db/models/seamless.py`: `EMBEDDING_DIM=1536`, 컬럼·인덱스·docstring 갱신,
  halfvec expression 헬퍼 삭제.

### 4. worker 사용부

- `motifs/store.py`: halfvec 캐스트 제거(cosine_distance 직접), 컬럼명 교체.
- `authoring/store.py`, `authoring/promotion.py`, `authoring/retrieval.py`,
  `motifs/embeddings.py`, `motifs/resolver.py`: 컬럼명·task_type·provider 문자열 교체.
- `api/routes.py`: `adapters.gemini` → `adapters.llm`, 미구성 503 메시지·provider 교체.
- `api/schemas.py`: `EMBEDDING_DIM` 갱신은 import라 자동 — min/max_length가 1536으로.

### 5. api·admin

- `apps/api/.../admin/authoring.py`: `embedding_vertex` 속성·응답 키 →
  `embedding_openai`. **응답 스키마 키가 바뀌므로 `pnpm codegen` 동반 커밋.**
- `apps/api/.../admin/generation.py` provider 라벨 맵:
  `"openai": "OpenAI"`, `"openai_embedding": "OpenAI 임베딩"`으로 교체
  (과거 로그의 `"gemini"` 문자열은 라벨 fallback으로 원문 표시 — 허용).
- `apps/admin/.../seamless-detail.tsx`(+ 테스트): 라벨 맵 동일 교체.

### 6. 인프라·환경

- `infra/iam.tf`: `worker_vertex_ai`(roles/aiplatform.user) 삭제.
- `infra/cloudrun.tf`: `worker_generate_secret_env`에
  `OPENAI_API_KEY = app["openai-api-key"]` 추가 — Secret Manager 앱 시크릿 목록에
  `openai-api-key` 등록(RECRAFT_API_KEY와 같은 배선). **authoring/임베딩 라우트가
  finalize 서비스에도 있는지 service_mode 라우팅을 확인해 필요한 서비스 전부에 주입.**
- `.env.example`: `VERTEX_AI_LOCATION` 삭제, `OPENAI_API_KEY=` 추가.
  `GCP_PROJECT_ID`는 api(Cloud Tasks 등)가 쓰면 유지.
- `infra/README.md` 시크릿 부트스트랩 목록 갱신.

### 7. 스크립트·시드

- `scripts/index_motif_embeddings.py`, `seed_authoring_examples.py`,
  `eval_authoring.py`: 새 클라이언트로 교체, "Vertex ADC 필요" 문구 →
  "`OPENAI_API_KEY` 필요". 유료 호출이므로 `--confirm-live`는 유지.
- 마이그레이션 후 **재임베딩 실행 순서**: `alembic upgrade head` →
  `index_motif_embeddings.py --confirm-live` →
  `seed_authoring_examples.py --confirm-live`(active 복구 포함).

### 8. 테스트

- `test_adapters.py`: fake genai 클라이언트 → `httpx.MockTransport` 기반으로 재작성
  (재시도·strict 스키마 변환·차원 검증·withholding 커버 유지).
- `test_config.py`: temperature 검증 삭제, 새 설정 필드 검증.
- 나머지(test_api_generate/motifs, test_motif_store, test_authoring_*,
  test_generation_logging): 주입 fake의 시그니처·컬럼명·provider 문자열 추종.
- `apps/api/tests/test_admin_generation.py`·`test_admin_authoring.py` 라벨·키 추종.

### 9. 문서

- `ARCHITECTURE.md`, `AGENTS.md`(시드 명령의 "Vertex ADC/GCP project 필요" 문구),
  `README.md`, `docs/api-spec/worker-pipeline.md`, `docs/api-spec/worker-motifs.md`,
  `docs/OPERATOR-CHECKLIST.md`, `db/MAPPING.md`, `db/README.md` 갱신.
- `docs/reviews/`·과거 플랜은 역사 기록 — 손대지 않는다.

## 리스크 (실행 전 인지)

1. **`motif_similarity_tau=0.84` 재캘리브레이션 필수.** 기존 τ는 gemini-embedding-001의
   코사인 유사도 분포 기준 — text-embedding-3-large는 분포가 다르다. 재임베딩 후
   기존 카탈로그 쿼리 몇 개로 스코어 분포를 뽑아 τ를 다시 정한다(authoring retrieval에
   유사 임계값이 있으면 동일 적용).
2. **strict 스키마 변환 검증.** DesignPlanV3는 판별 유니온·optional이 많다 —
   `_strict_json_schema` 산출물이 OpenAI strict 제약을 통과하는지 실제 호출 1회로 확인
   (실패 시 해당 계약만 `strict:false` + pydantic 루프로 폴백하고 플랜에 기록).
3. **프롬프트 회귀.** 프롬프트 revision 문자열을 올리고(`…-openai-v1`), 기존 캡스톤
   프롬프트 세트(grounding 25/25 기준)를 `eval_authoring.py`로 재실행해 회귀 확인.
4. **로컬 DB 드리프트.** 로컬 실행 DB는 baseline과 이미 어긋나 있음(orphan rev) —
   로컬 검증은 파괴적 리셋(`docker compose down -v` → up → upgrade → 시드 전체) 전제.

## 검증

- `uv run pytest` / `uv run ruff check .` / `uv run pyright`
- `pnpm lint` / `pnpm turbo build typecheck test` / `pnpm codegen`(드리프트 0)
- 레거시 0 확인: `grep -ri 'gemini\|vertex\|genai' --include='*.py' --include='*.ts' --include='*.tsx' --include='*.toml' --include='*.tf'` 히트가 docs/reviews 외 0건.
- 로컬 리셋 후 E2E: 시드 → 재임베딩 → store에서 텍스트 프롬프트 생성 + 구성 수정 +
  아이디어 제안 1회씩 (aside-browser).
