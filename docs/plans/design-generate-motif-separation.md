# 디자인 생성과 모티프 생성의 완전 분리 — Recraft·참고 사진을 디자인 생성에서 제거

## 무엇을 바꾸나

디자인 생성이 **이미 존재하는 모티프만** 사용하게 한다. 새 모티프가 필요하면 모티프
모달(AI 생성·사진 벡터화·글자·SVG)에서 만들고, 디자인 생성은 그것을 참조만 한다.

- 디자인 생성의 Recraft 호출 경로 2종을 제거한다:
  - `{"source":"generate"}` — 프롬프트 문장에서 뽑은 subject로 Recraft 생성
    (`gemini.py:268-276` 지시 → `compiler.py:187-198` → `resolver.py` 생성 래더)
  - `{"source":"reference"}` — 첨부 사진을 Gemini가 설명문으로 바꿔 Recraft 생성
    (`compiler.py:162-180`). 사진이 벡터화되는 게 아니라 설명문 기반 재생성이었다.
- **참고 사진 첨부 기능 자체를 없앤다** — 디자인 생성·아이디어 제안 양쪽. 색감/무드/구도
  참고 역할까지 포함해 전부 제거한다. 모티프는 모티프 패널이, 색은 색 지정이 담당하는데
  참고 사진이 제3의 우회 경로를 만들어 혼동만 유발한다.
- 디자인 생성 입력은 **프롬프트 + 슬롯 모티프(input) + 카탈로그 히트(catalog) + 팔레트**로
  수렴한다. 플랜 모티프 소스는 `input | catalog` 2종만 남는다.

**유지하는 것** (이 플랜의 제거 대상이 아님):

- 모티프 모달의 사진 벡터화(vtracer, `photo_svg.py`)와 팔레트 추출(사진에서 색,
  `/design/palette/extract`) — 이 둘이 staged 업로드 인프라
  (`_resolve_staged_reference_image`·`_reference_image_payload`·`uploadDesignPhoto`)를
  계속 쓰므로 인프라는 남긴다.
**레거시는 남기지 않는다** — 개발 단계이므로 참고 사진 관련 과거 데이터·컬럼·테이블은
전부 삭제하고, admin의 과거 로그 표시 코드도 제거한다(3단계).

해결하는 문제:

1. **예산 밖 과금** — 모달은 세션 예산(`recraft_used`) 선차감·환급·잔여 노출까지 갖췄는데,
   디자인 생성 경로는 그 예산을 안 거치고 서버 내부 한도(요청당 2회)로만 막았다. 사용자가
   보지도 동의하지도 않은 과금이 가능했다. 제거 후 세션 예산 = 실제 Recraft 비용 전부.
2. **분리 원칙 위반** — 슬롯 메뉴로 모티프 소스를 일원화한 방향과 달리, 디자인 생성이
   뒤에서 조용히 새 모티프를 만들어 카탈로그에 넣었다.
3. **사용자 혼동** — 사진이 모티프가 되는 경로가 둘(모달 벡터화 vs 참고 사진 재생성)이고
   결과 성격이 전혀 달랐다.

## 실행 순서

각 단계는 독립 커밋 가능. 1–2는 worker, 3은 db+admin, 4는 worker 예시,
5는 api(+codegen), 6은 store, 7은 문서.
worker→api→store 순서를 지키면 어느 시점에 배포돼도 요청이 깨지지 않는다
(api·store가 보내는 필드가 워커에서 사라지기 전에 보내는 쪽을 먼저 줄이는 게 아니라,
StrictRequest가 unknown 필드를 거부하므로 **받는 쪽을 먼저 관대하게 줄일 수 없다** —
따라서 1·2단계는 스키마에서 필드를 지우되 배포는 5·6과 함께 묶는다. 로컬 모노레포
개발에서는 순서대로 커밋하면 된다).

### 1. worker: authoring에서 generate·reference 소스 제거

- `authoring/schema.py` — `GenerateMotifSource`·`ReferenceMotifSource`·`_DescribedMotifSource`
  삭제. `PlanMotifSource = InputMotifSource | CatalogMotifSource`.
- `authoring/compiler.py` — `_resolve_motif_sources`의 reference/generate 분기(162-198)와
  reference 카운트 검증 삭제. `_ResolvedMotifSource.spec`·`motif_specs` 필드와
  `AuthoredDesign.motif_specs` 제거 — 모든 소스가 컴파일 시점에 `motif_id`로 확정된다.
- `adapters/gemini.py` — generate 소스 지시(268-276), 참고 이미지 역할 지시(290-318),
  `author_design`의 `reference_images` 파라미터와 이미지 파트 조립, reference 모티프
  관련 재시도 피드백 제거. `suggest_ideas`의 `reference_images` 파라미터도 제거.
- `motifs/resolver.py` — `resolve_motifs`와 그 전용 기계(레이어 drop cascade,
  `UNSUPPORTED_SPEC_FIELDS` 중 design 경로 전용 부분) 삭제. 호출자는 디자인 생성
  라우트 하나뿐임을 확인했다. **`resolve_spec`·`present_candidates`·
  `MotifGenerationBudget`·`_BudgetedRecraftClient`·`_screen_facets`는 모달 경로
  (`/motifs/generate`·`/motifs/candidates`)가 쓰므로 유지.**

테스트: authoring 플랜에 `source:"generate"`/`"reference"`가 오면 스키마 검증 실패로
재프롬프트 피드백이 도는 것, 컴파일 결과에 semantic placeholder(`semantic_N`)가 더는
없는 것. 기존 golden 테스트는 intent 기반이라 영향 없어야 한다(모티프는 motif_id 참조).

### 2. worker: /generate·/ideas 라우트에서 참고 사진·Recraft 제거

- `api/schemas.py` — `GenerateRequest.reference_images`·`ReferenceImageInput`(디자인
  생성용)·purpose 검증 삭제. 입력 검증을 "prompt 또는 motif_ids 필수"로 갱신.
  `IdeasRequest.reference_images`도 삭제. `MotifIngressProvenance`는 모달 경로가
  쓰므로 유지하되 `/generate` payload에서는 제거.
- `api/routes.py` /generate — `_load_reference_images`·`motif_photo_indexes`,
  `resolve_motifs` 호출과 `recraft_client=adapters.recraft` 주입(807-822),
  `generation_budget`·`recraft_calls` 진단(852-854), `input_type="reference_image"`
  분기, `_persist_reference_attachments`와 로그의 reference 필드 기록 전부 제거.
  `/ideas`의 reference 로딩(1335-1342) 제거. `_reference_image_client`·
  `_load_reference_image_items`는 다른 사용처가 없으면 함께 삭제.
- 워커 어댑터 `build_adapters`는 그대로 — Recraft 클라이언트는 모달 경로가 쓴다.

테스트: `/generate`가 reference_images 필드를 받으면 422(StrictRequest), 카탈로그
miss 모티프 spec이 더는 존재하지 않으므로 Recraft mock이 디자인 생성 테스트에서
호출되지 않는 것. `test_generation_logging`의 reference 케이스는 삭제/조정.

### 3. db+admin: 참고 사진 레거시 완전 삭제

스키마 변경은 대원칙대로 Alembic 리비전 하나로 처리한다(직접 DDL 금지). 개발 단계라
데이터 보존 없이 바로 지운다 — downgrade는 형식만 갖추면 된다.

- Alembic 리비전(`db/`):
  - `seamless_generation_attachments` 테이블 **drop** (참고 사진 첨부 레코드 포함).
  - `seamless_generation_logs`에서 `has_reference_image`·`reference_image_bytes` 컬럼
    drop, `input_type = 'reference_image'` 행 delete 후 check constraint를
    `('intent', 'prompt')`로 좁힌다.
  - 첨부가 참조하던 `images` 행 중 참고 사진 전용 스테이징 이미지는 고아로 남으면
    함께 delete(다른 도메인이 참조하는 images는 건드리지 않는다).
- `db/src/db/models/seamless.py` — `SeamlessGenerationAttachment` 모델,
  `SeamlessGenerationLog`의 두 컬럼·constraint 값 제거. `db/MAPPING.md` 갱신.
- api `domains/admin/generation.py` — `_seamless_reference_images`·
  `SeamlessReferenceImageOut`·`prepare_reference_image` 사용·`purpose` 직렬화 등
  참고 사진 표시 코드 삭제.
- admin `pages/generation/seamless-detail.tsx`·`seamless-list.tsx`·
  `generation-labels.ts` — 참고 사진 썸네일·`reference_image` 입력 타입 라벨·
  `recraft_calls` 표시 제거. 관련 테스트 갱신.

### 4. worker: 어소링 예시 정리

시드된 어소링 예시(DB)의 플랜에 reference/generate 소스가 포함돼 있으면 1단계 이후
스키마 검증에 실패한다. 해당 예시는 남기지 말고 **delete 후 재시드**한다:

- reference/generate 소스를 포함한 `authoring_examples`(및 promotion candidate) 행 delete.
- 시드 스크립트가 input/catalog 소스만 생성하도록 프롬프트/필터 갱신 후 재시드
  (`--confirm-live`). `eval_authoring.py`·`gallery_eval_prompts.json`의 reference/generate
  기대 케이스도 함께 정리.

### 5. api: 디자인 생성·아이디어에서 참고 사진 제거 (+ codegen)

- `domains/design/router.py` —
  - 디자인 생성 요청 모델(361 부근)과 아이디어 요청 모델(410 부근)에서
    `reference_images` 필드·upload_id 중복 검증 삭제.
  - 생성 라우트의 참고 사진 해석(1162-1210: `_resolve_reference_images`, purpose
    카운트, 커밋된 디자인 422 분기 중 사진 관련)과 아이디어 라우트의 참고 사진
    해석(746-761) 삭제. `/generate` payload에서 `motif_provenance` 제거(Recraft 유입
    provenance는 모달 경로 전용이 된다).
  - `_resolve_reference_images`(다중)·관련 헬퍼는 사용처가 palette extract·photo
    preview의 단건 헬퍼(`_resolve_staged_reference_image`)로만 남으면 다중 버전 삭제.
- **api 스펙이 바뀌므로 `pnpm codegen` 후 `packages/api-client` 생성물을 같은 커밋에**
  (CI codegen-drift).

테스트: 디자인 생성/아이디어 요청에 `reference_images`가 오면 422. testcontainers
인가 테스트는 영향 없음.

### 6. store: 참고 사진 UI 제거

- 삭제: `features/design/model/use-photo-references.ts`,
  `features/design/ui/photo-reference-modal.tsx`.
- 수정: `use-prompt-generation.ts`(photos 배선), `pages/design/index.tsx`
  (referenceImages 전달·첨부 진입점 UI), `use-generate.ts`·`api/context-tools.ts`
  (reference_images 매핑), draft의 `DesignReferenceImage` 타입·복원 로직.
- **유지**: `api/attachments.ts`의 `uploadDesignPhoto`·`validateImageFile` — 모티프
  모달 사진 경로(`use-motif-search.ts:264`)가 쓴다. `MAX_DESIGN_PHOTOS`는 사용처가
  모달 단건뿐이면 상수 정리.

테스트: `pages/design/index.test.tsx`의 참고 사진 케이스 삭제, 생성 요청 payload에
reference_images가 없는 것.

### 7. 문서 갱신

- `ARCHITECTURE.md` — 디자인 생성 파이프라인에서 Recraft·참고 사진 단계 제거, "Recraft는
  모티프 모달 전용" 명시.
- `docs/api-spec/worker-pipeline.md`·`domains.md`·`money.md` — generate/reference 소스,
  reference_images 필드, 디자인 생성 Recraft 과금 서술 제거. `worker-motifs.md`의
  vectorize 5단계 재도입 계획은 "모달 사진 경로(vtracer)로 대체됨"으로 정리.
- `docs/CHECKLIST.md` 체크 상태 갱신. 완료 후 이 플랜을 `docs/reviews/`로 요약 이동.

## 비범위

- 모티프 모달의 사진 벡터화·팔레트 추출·AI 생성(Recraft)·세션 예산 기계는 변경 없음.
- `svg_safety`·facet 살균(C-10)은 모달 유입이 남으므로 변경 없음.
- 카탈로그의 기존 `source="recraft"` 모티프는 유지 — 모달 생성물과 구분할 수 없고,
  이미 사용자 디자인이 참조 중일 수 있다.
