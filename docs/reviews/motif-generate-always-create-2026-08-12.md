# 모티프 AI 생성 — 재사용 래더 전면 제거 결과 — 2026-08-12

`docs/plans/motif-generate-always-create.md`(삭제, git 이력 참조) 실행 결과.
피커 "AI 생성"은 유사 카탈로그 확인 없이 항상 바로 생성한다 — 비슷한 모티프 확인은
검색(candidates) 단계가 이미 눈에 보이게 수행하므로, 생성 경로의 숨은 재사용 판정
(동백꽃↔flower 0.4x 영구 차단)을 폐기했다. `docs/api-spec/worker-motifs.md`의
"같은 문장 = 재사용 판정" 계약도 함께 개정(의도된 기능 명세 변경).

## 삭제한 것

- worker `resolve_spec`: retrieval→재사용 분기·τ 게이트·`embedding_client`·죽은
  `upsert_sessionmaker` 파라미터. `ResolveResult`는 소비자가 없어 dataclass째 제거,
  motif_id(str)만 반환. `retrieve_catalog`도 `CatalogRetrieval` 래퍼를 벗기고
  `list[CatalogMatch]` 반환으로 단순화(query_vec 소비자가 사라짐).
- `_select_variant`·`_cosine`, `store.find_variant_pool`·`PoolMember`,
  `determinism.select_variant`.
- variant_group 계열 전체: `variant_group_key`, upsert kwarg, `MotifMeta`/`MotifMatch`
  필드, SELECT 컬럼, seed_motifs 기록, api user-upload insert 값,
  admin `MotifSummaryOut.variant_group`·detail 메타데이터 행.
- **DB `motifs.variant_group` 컬럼 drop** — `a4d9c1e57b02` 리비전. downgrade는 컬럼
  복원 후 subject/scope로 재계산(원 키 함수와 동일 로직 내장).
- api `WorkerMotifGenerateOut.reused`·`MotifGenerateOut.reused` + reused 예산 환급
  분기(실패 환급 `_release_recraft_budget`은 유지). `pnpm codegen` 재생성 포함.

## 유지한 것

- `retrieve_catalog`·`prompt_catalog_candidates`(저작 grounding)·`present_candidates`
  (검색 UI 후보) — 재사용의 보이는 절반. `motif_similarity_tau`·임베딩 인덱싱도 유지.
- `_screen_facets` 안전 스크리닝, 예산 선차감(세션 3회)·요청당 2회 상한·실패 환급,
  pending 업서트·admin 승인 게이트.

## 검증

- `uv run pytest` / `pnpm turbo build typecheck test` / `pnpm lint` /
  `uv run ruff check .` / `uv run pyright` 통과, `alembic upgrade head` 적용,
  codegen 드리프트 0 (admin 프로덕션 빌드는 로컬 `.env` 부재로 `VITE_API_BASE_URL`
  주입해 실행 — 기존 환경 조건, 이번 변경과 무관).
- 삭제 심볼 grep 0건 (`reused`·`variant_group`·`select_variant`·`find_variant_pool` —
  무관한 동명 로컬 변수 제외).
- 새 계약 테스트: 카탈로그 exact hit여도 생성, 같은 문장 2회 → Recraft 2회·pending
  2행, Recraft 실패 → 예외 전파(업서트 없음), 스크리닝·예산·provenance 경로 유지.
- Aside 재현(Recraft 실 호출 2회): 카탈로그에 벌 시드가 있는 "꿀벌"로 AI 생성 →
  새 pending `recraft-52761a02a3a8`, 같은 문장 재클릭 → 또 새 pending
  `recraft-81afdfd301ef`(둘 다 세션 provenance 기록), `recraft_used` 0→2,
  admin 게이트(pending) 2건. 콘솔 오류 0.
- **부수 수정**: 생성 성공 후 store의 "N번 남음" 카운터가 갱신되지 않던 것을 발견
  (세션 쿼리를 예산 소진 에러에서만 무효화 — 기존 동작이나 환급 제거로 상시 노출).
  `use-motif-search.ts` 성공 경로에 `designSessionQueryKey` 무효화 추가.
- 저작 grounding 회귀 없음: `/motifs/candidates` "동백꽃" → exact 1.0 매치 3건 유지.
