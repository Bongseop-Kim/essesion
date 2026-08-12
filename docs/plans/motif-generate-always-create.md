# 모티프 AI 생성 — 재사용 래더 전면 제거 플랜

> 결정: 피커 "AI 생성"은 유사 카탈로그 확인 없이 **항상 바로 생성**한다.
> 비슷한 모티프 확인은 검색(candidates) 단계가 이미 눈에 보이게 수행하므로,
> 생성 경로의 숨은 재사용 판정은 같은 일을 두 번 하며 사용자의 명시적 의사를
> 뒤집는다(동백꽃↔flower 0.4x 영구 차단, `motif-catalog-recraft-boost-2026-08-12.md`).
> 미사용이 되는 코드·컬럼·스키마 필드는 **잔재 없이 전부 삭제**한다.
>
> ⚠ 이것은 의도된 **기능 명세 변경**이다 — `docs/api-spec/worker-motifs.md`의
> "같은 문장 = 재사용 판정" 계약을 폐기하고 명세 문서도 함께 고친다.

## 바뀌는 동작

- `POST /design/sessions/{id}/motifs/generate`: 예산 선차감 → 안전 스크리닝 →
  **무조건 Recraft 생성** → pending 업서트. 재사용 분기 없음.
- 같은 문장 재클릭도 새 변형을 만든다 — (subject, scope)가 같은 모티프가 쌓이는
  것은 변형 풀 확충이며, 품질·중복은 admin 승인 게이트가 거른다.
- 비용 상한 불변: 세션당 3회(`design_recraft_budget`, 선차감·실패 환급 유지) ×
  요청당 2회(`motif_generate_per_request_limit`).

## 삭제 목록 (전수 조사 결과 — 실행 시 grep으로 재확인할 것)

### worker

- `motifs/resolver.py` `resolve_spec`:
  - retrieval→재사용 분기 전체(τ 게이트, `reused=True` 반환 경로).
  - `embedding_client` 파라미터(재사용 판정 전용이었음)와 τ 읽기.
  - `upsert_sessionmaker` 파라미터 — 호출처가 한 곳(`routes.py` motif_generate)뿐이고
    거기서도 안 쓰는 **이미 죽은 코드**.
  - `ResolveResult`의 `reused`·`similarity`·`match_type`·`subject` — 남는 소비자가
    없으면 dataclass 자체를 없애고 motif_id만 반환.
- `motifs/resolver.py` `_select_variant` 함수 전체 + 그 안에서만 쓰이는
  `_cosine`(다른 사용처 grep 확인 후).
- `motifs/store.py` `find_variant_pool` + `PoolMember` dataclass.
- `engine/determinism.py` `select_variant` (유일 호출처가 `_select_variant`).
- `api/routes.py` motif_generate 응답에서 `reused`·`similarity` 키 제거.

### variant_group 계열 (읽는 코드가 재사용 풀뿐이라 통째로 죽는다)

- `motifs/store.py` `variant_group_key`, `upsert_motif`의 variant_group kwarg,
  `MotifMeta`/`MotifMatch`의 variant_group 필드, retrieve_catalog SELECT 컬럼.
- `scripts/seed_motifs.py`의 variant_group 기록(+"풀 시연" 주석).
- api: `router.py:732` user-upload의 `variant_group=None`,
  `admin/generation.py` `MotifDetailOut.variant_group`(:273)과 매핑(:1061).
- admin: `pages/motifs/detail.tsx`의 variant_group 메타데이터 행.
- **DB: `motifs.variant_group` 컬럼 drop — Alembic 마이그레이션으로만**
  (`db/src/db/models/seamless.py:65` 모델 수정 + revision, DDL 직접 실행 금지).
  값은 `sha256(subject, scope)` 파생이라 정보 손실 없음. downgrade는 컬럼 복원 후
  subject/scope로 재계산.

### api 응답 스키마 (→ `pnpm codegen` 필수, 같은 커밋에 생성물 포함)

- `WorkerMotifGenerateOut.reused`, `MotifGenerateOut.reused` 필드 삭제.
- `_dispatch_motif_generation`의 `if out.reused: 예산 환급` 분기 + "래더 재사용"
  언급 주석 삭제. 실패 시 환급(`_release_recraft_budget`)은 유지.

### store

- 동작 코드 무수정(`use-motif-search.ts`는 reused를 읽지 않음 — 확인됨).
  `pages/design/index.test.tsx`의 `reused: false` 픽스처만 제거.

### 문서

- `docs/api-spec/worker-motifs.md`: 검색 래더·재사용 판정·variant_group(§5.6) 절을
  새 계약(생성은 항상 생성, candidates만 catalog hit)으로 개정. 문서 머리의
  "원문 보존" 성격이 바뀌는 것이므로 개정 이력을 한 줄 남긴다.

## 유지 목록 (혼동 방지)

- `retrieve_catalog`·`prompt_catalog_candidates`(저작 grounding, 노랑 경고 포함)와
  `present_candidates`(`POST /motifs/candidates`, 검색 UI 후보) — 재사용의 **보이는**
  절반은 그대로다.
- `motifs.embedding_openai` 컬럼·임베딩 인덱싱 스크립트 — grounding·검색이 쓴다.
- `_screen_facets` 안전 스크리닝, `MotifGenerationBudget`/`_BudgetedRecraftClient`,
  예산 선차감·실패 환급, pending 업서트·admin 승인 게이트.
- `motif_similarity_tau` 설정 — grounding·candidates가 계속 사용.

## 테스트

- worker `resolve_spec` 재사용 케이스 테스트 → 삭제하고 새 계약으로 교체:
  같은 문장 2회 → Recraft(mock) 2회·모티프 2개, Recraft 실패 → 예외 전파(업서트 없음),
  스크리닝 거부 경로 유지.
- 삭제 대상 심볼이 레포 어디에도 남지 않았는지 grep 0건 확인
  (`reused`·`variant_group`·`select_variant`·`find_variant_pool`).
- api motif generate 테스트에서 reused 단정 제거, 예산 선차감·실패 환급 단정 유지.

## 검증 (성공 기준)

- `uv run pytest` + `pnpm turbo build typecheck test` + `pnpm lint` 통과,
  `alembic upgrade head` 적용, codegen 드리프트 0.
- Aside 재현 (**Recraft 실 호출 2회 발생 — 실행 승인에 포함**):
  카탈로그에 있는 소재(예: "꿀벌")로 AI 생성 → 재사용 없이 **새 pending 모티프**,
  같은 문장 재클릭 → 또 새 모티프, 예산 카운터 감소·admin 게이트에 2건 노출.
- 저작 grounding 회귀 없음: 동백꽃 프롬프트 exact 매치·기존 하네스 케이스 통과.

## 상태 — 계획
