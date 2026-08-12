# 모티프 메타데이터 자동 태깅·편집 플랜

> 결정: recraft 생성 모티프의 메타데이터 공백을 없앤다. 현재 recraft 모티프는
> `subject`·`scope`만 채워져 임베딩 문서가 사실상 subject 단독 임베딩이고
> (`store.embedding_document`가 조립하는 `description/style/view/expression/tags`가
> 전부 NULL), 한글 검색은 seed 전용 수작업 맵(`seed_motifs._KO_TAGS` 75종 +
> `resolver`의 한→영 alias)에 의존하며, admin에서는 status 외 어떤 필드도
> 고칠 수 없다.
>
> 방향은 DAM 업계 표준 패턴(AI가 기본 태그 층 생성 + 사람 검수) 그대로다.
> 이 레포는 pending→승인 게이트가 이미 검수 단계이고, 임베딩 인덱서가
> approved만 처리하므로 LLM 환각이 검색 풀에 자동 유입되지 않는다 — 새로
> 만들 방어 장치가 없다.
>
> 검색 구조(lexical exact-token + pgvector 2단계, 상태 필터 SQL 결합)는
> 무수정. 채워 넣는 데이터만 바꾼다.

## 1. 생성 시점 자동 태깅 — `apps/worker/src/worker/adapters/motif_tagging.py`

`resolver.resolve_spec`이 모티프 생성·정규화에 성공한 직후, upsert 전에 1콜.

- **입력**: 정규화된 모티프 SVG를 래스터로 렌더(렌더 경로는
  `motif_render_check`가 이미 쓰는 것 재사용) + `subject`.
  텍스트만으로는 subject 이상의 정보가 없으므로 반드시 비전 입력.
- **호출**: 기존 OpenAI 클라이언트 패턴(`adapters/llm.py`·`embedding.py`)과
  `openai_api_key` 설정 재사용. structured output 스키마:
  `{description: str, tags_ko: list[str], tags_en: list[str], style: str}`.
  `style`은 enum(`flat|outline`)으로 제약 — seed와 어휘 통일.
- **저장**: `facets_from_spec` 경로에 병합해 upsert. LLM 산출물은 유입
  살균(`resolver._screen_facets`)을 기존 facet과 동일하게 통과시킨다 —
  비전 모델 출력도 untrusted로 취급.
- **실패 시 fail-soft**: 태깅 실패해도 모티프 저장은 현행대로 진행
  (subject만). 예외를 생성 경로로 전파하지 않는다.
- 어댑터 교체 파일럿(gpt-image)과 독립 — 태깅은 정규화된 SVG를 입력으로
  받으므로 생성 어댑터가 무엇이든 동일하게 동작한다.

## 2. 기존 카탈로그 백필 — `apps/worker/scripts/backfill_motif_tags.py`

- 대상: `source != 'user_upload'`이고 `description IS NULL`인 행(현재 총
  110건 중 seed 97건은 description·tags가 이미 있어 제외 — 실질 recraft
  십수 건). 유료 호출이므로
  `--confirm-live` 필수(하우스 패턴).
- 태깅 성공 행은 `embedding_openai = NULL`로 리셋 → 기존
  `index_motif_embeddings.py --confirm-live`가 재임베딩. 재임베딩 로직을
  새로 만들지 않는다.
- 멱등: description이 이미 있으면 건너뛴다.

## 3. admin 메타데이터 편집 + 재임베딩 트리거

- **API**: `PATCH /admin/motifs/{id}` — `subject/description/tags/style`만
  수정 허용. `scope`·`source`·provenance는 불변. `role == "admin"`만
  (review와 동일). 텍스트는 기존 `_safe_metadata` 절단 규칙 적용.
- **핵심 규칙**: 위 필드 중 하나라도 바뀌면 같은 트랜잭션에서
  `embedding_openai = NULL` 리셋. 인덱서가 NULL만 채우는 멱등
  구조(`store.update_embedding_if_missing`)라 이것만으로 재임베딩이 성립한다.
- **프론트**: 상세 페이지(`apps/admin/src/pages/motifs/detail.tsx`) 검토
  카드 옆에 편집 폼. 목록 인라인 편집은 하지 않는다.
- api 스펙 변경이므로 `pnpm codegen` 후 생성물 동일 커밋(CI drift 검사).
- registry fingerprint는 approved id 집합만 보므로 메타데이터 편집으로
  결정론 stamp가 움직이지 않는다 — 확인만 하고 손대지 않는다.

## 4. `view`·`expression` 컬럼 삭제

seed·recraft·upload 어느 경로도 채운 적 없는 죽은 유연성. 1번 태깅
스키마에도 넣지 않는다(의미가 불명확한 필드를 LLM에게 채우게 하면 노이즈만
는다).

- Alembic 마이그레이션으로 두 컬럼 드롭.
- 제거 지점: `Motif` 모델, `store.embedding_document`·`MotifMeta`·
  `facets_from_spec`, `resolver._SCREENED_FACETS`·`prompt_catalog_candidates`,
  `llm._CATALOG_TEXT_FIELDS`, admin `MotifSummaryOut`/`MotifDetailOut`과
  목록·상세 UI, `docs/api-spec/worker-motifs.md` §1·§4.
- 임베딩 문서 조립 순서가 바뀌지만 두 필드가 항상 빈 값이었으므로 기존
  벡터와 실질 동일 — 전면 재임베딩은 하지 않는다.

## 검증

- 태깅 어댑터: 가짜 클라이언트로 성공/실패(fail-soft)/살균 거부 3경로
  pytest — 기존 어댑터 테스트 패턴(`tests/test_adapters.py`).
- 편집 API: testcontainers로 admin/manager 인가, 편집 → `embedding_openai IS
  NULL` 확인, 이후 인덱서 실행 시 재임베딩되는지까지 1케이스.
- 백필: `--confirm-live` 없이 거부, 멱등(2회 실행 시 2회차 no-op).
- 수동: admin 상세에서 태그 편집 → 저장 → 스토어 모티프 검색에서 새 태그로
  exact-token 매칭 확인(인덱서 실행 후 의미 검색도).
- `pnpm turbo build typecheck test`, `uv run pytest`, `uv run ruff check .`,
  `uv run pyright`.

## 하지 않는 것

- 검색 파이프라인·τ·임베딩 모델 변경.
- CLIP류 이미지 임베딩, 태그 온톨로지 — 카탈로그 수천 건 + 오검색이 실제
  보고될 때 별도 플랜으로.
- `_KO_TAGS`·한→영 alias 맵 즉시 제거 — seed 태그는 유지하고, 자동 태깅이
  정착해 검색 로그로 대체 가능성이 확인되면 그때 은퇴.
- user_upload 모티프 태깅 — 검색 풀 밖이므로 대상 아님.

## 상태 — 계획
