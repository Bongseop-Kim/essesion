# 모티프 생성 전환 플랜 — Recraft 제거 → GPT Image 2 low

> 선행 근거: [20건 파일럿 결과](../reviews/motif-adapter-gpt-image-pilot-2026-08-12.md).
> GPT Image 2 low + VTracer medium은 저장 원본 재처리에서 20/20을 통과했고,
> 최대 path 예산 사용률은 16.5%였다.
>
> 결정: 명시적 새 모티프 생성 provider를 GPT Image 2로 단일화한다. Recraft
> fallback, provider 선택 설정, 이중 쓰기는 두지 않는다. 이미지 생성은
> `model=gpt-image-2`, `quality=low`, `size=1024x1024`; 로컬 벡터화는 전경 최대
> 6색 + VTracer medium + 기존 SVG 정규화/승인 게이트를 사용한다.
>
> **clean break**: 이 시스템은 아직 스테이징·프로덕션 미개통이므로 Recraft 스키마,
> 데이터, ID, fixture, golden, 호환 alias를 보존하지 않는다. Recraft를 썼다는 사실은
> `docs/reviews/`와 git 이력에만 남긴다. 로컬 DB는 새 baseline으로 재생성한다.

## 불변 계약과 명칭

| 의미 | 전환 후 명칭 |
|---|---|
| worker adapter 속성 | `gpt_image` |
| DB `motifs.source` 신규 값 | `gpt_image` |
| 신규 motif ID prefix | `gpt-image-` |
| 안전한 오류 진단 provider | `openai_image` |
| 세션 사용량 | `motif_generation_used` |
| 세션 잔여량 | `motif_generation_remaining` |
| API 예산 설정 | `design_motif_generation_budget` |
| 예산 소진 error code | `motif_generation_budget_exhausted` |

- `normalize_motif_svg`의 암묵적 `recraft` ID prefix를 제거한다. 각 ingress가 prefix를
  명시한다: seed=`seed`, GPT Image=`gpt-image`, 사용자 업로드=`upload`, 테스트 fixture는
  provider 중립 prefix.
- `store.upsert_motif`과 DB의 `source='recraft'` 기본값도 제거한다. 모든 호출자가
  `seed | gpt_image | user_upload` 중 자기 source를 명시한다.
- 구 `recraft-*` seed/golden/test ID는 전부 새 prefix로 재생성한다. 기존 로컬 Recraft
  행과 그 세션 참조를 이관하거나 호환하는 코드는 작성하지 않는다.
- 검색, pending→approved 관리자 게이트, 최초 유입 user/session provenance,
  세션당 3회 선차감·실패 환급 의미는 그대로 유지한다.
- 디자인 저작·catalog miss는 계속 자동 생성하지 않는다. GPT Image 호출은 사용자가
  모티프 모달에서 `motifs/generate`를 명시적으로 실행할 때만 발생한다.

## 1. baseline DB·공개 API 명칭 전환

미배포 migration chain을 clean break한다. 새 호환 revision이나 데이터 변환 SQL을
추가하지 않고, Alembic baseline 자체를 현재 정본으로 고친 뒤 빈 DB에서 현재 head까지
다시 적용한다. 직접 DDL은 실행하지 않는다.

- baseline의 `design_sessions.recraft_used`를 `motif_generation_used`로 교체하고 CHECK
  constraint도 일반 명칭으로 만든다. 구 컬럼을 읽거나 rename하는 migration은 없다.
- baseline의 `motifs.source`에서 Recraft server default를 제거한다. 애플리케이션이
  source를 항상 명시하며 DB는 임의 provider를 추정하지 않는다.
- 기존 local DB·volume은 보존 대상이 아니다. 새 baseline 적용 후 계정/가격,
  motif, gallery, embedding/authoring example 순서로 공식 seed를 다시 실행한다.
- SQLAlchemy 모델, `db/MAPPING.md`, migration 검증을 같은 변경에 맞춘다.

API 계약도 provider 중립 명칭으로 바꾼다.

- `DesignSessionOut.recraft_used/recraft_remaining` →
  `motif_generation_used/motif_generation_remaining`.
- `Settings.design_recraft_budget` → `design_motif_generation_budget`.
- `recraft_budget_exhausted` → `motif_generation_budget_exhausted`.
- 선차감 조건부 UPDATE, worker 실패 환급, 목록에서는 remaining이 null인 현재 동작은
  유지한다.
- OpenAPI가 바뀌므로 `pnpm codegen`을 실행하고 `packages/api-client` 생성물을 함께
  반영한다. 구 필드·구 error code 호환 alias는 두지 않는다(미배포 단일 모노레포).

## 2. worker 런타임을 GPT Image로 배선

파일럿 어댑터 `apps/worker/src/worker/adapters/gpt_image.py`를 제품 경로로 승격한다.

- pilot 문구를 제거하되 검증된 고정값과 처리 순서는 바꾸지 않는다:
  - 흰 캔버스, 사방 최소 10% 안전 여백 프롬프트
  - 평탄 border-connected 배경 제거 → alpha 이진화
  - 보이는 전경에 최대 6색 양자화 → VTracer medium
  - VTracer 근사색을 양자화 팔레트로 snap
  - 투명 논리 canvas frame 보존 → `normalize_motif_svg`
- `Adapters.recraft`를 `Adapters.gpt_image`로 교체하고 `build_adapters`가 기존
  `OPENAI_API_KEY`/`OPENAI_BASE_URL`로 GPT Image 클라이언트를 만든다. LLM·embedding과
  키는 공유하지만 HTTP client lifecycle은 현재처럼 각 adapter가 소유한다.
- `routes.motif_generate`는 `adapters.gpt_image`를 resolver에 전달한다.
- `resolver.resolve_spec`의 parameter/import/주석을 provider 중립 또는 GPT Image
  명칭으로 바꾸고 `source='gpt_image'`로 upsert한다.
- `_BudgetedRecraftClient`는 byte PNG를 반환하는 provider 중립 budget wrapper로
  바꾼다. 요청당 최대 2회 생성(최초 + suitability gate 재생성)과 API 세션 예산은
  서로 다른 현재 두 경계로 유지한다.
- provider 미설정은 503, provider/transport·최종 gate 실패는 502, unsafe facet은
  422라는 HTTP 매핑을 보존한다.

## 3. Recraft 코드·설정·인프라 제거

런타임 전환과 테스트 교체가 끝난 뒤 다음을 삭제한다.

- `apps/worker/src/worker/adapters/recraft.py`와 Recraft 전용 adapter/gate/client 테스트.
- 완료된 비교용 `apps/worker/scripts/eval_motif_adapters.py` 및 전용 테스트. 판정 근거는
  reviews 문서와 로컬 scratch 산출물에 남긴다.
- worker `recraft_api_key/model/style/size/base_url` 설정과 `.env.example`의
  `RECRAFT_API_KEY`.
- OpenTofu의 `recraft-api-key` 선언, worker env 주입, Secret Manager accessor IAM과
  `infra/README.md` 입력 안내.
- `fixtures/recraft_samples`는 provider 중립 fixture 이름으로 바꾸고, normalize 기본
  prefix 제거에 맞춰 기대 ID와 관련 golden JSON/SVG를 전부 재생성한다. 구 ID를 alias로
  남기지 않는다.
- 코드 전환과 함께 Secret Manager 리소스를 제거하고 Recraft 측 API key도 폐기한다.
  이전 provider로 되돌아가는 운영 경로는 만들지 않는다.

## 4. store·admin·문서 정합

- store의 `recraftRemaining`과 API 오류 분기를 provider 중립 명칭으로 바꾼다. 사용자
  문구(“N번 남음”)와 검색→명시적 생성→활성화 UX는 바꾸지 않는다.
- admin 모티프 목록/상세의 “Recraft Motif” 문구를 “AI 생성 Motif”로 바꾸고
  현재 source 값(`seed | gpt_image | user_upload`)만 표시한다.
- `ARCHITECTURE.md`의 외부 provider 다이어그램, 생성 흐름, 안전성·관측성·readiness를
  GPT Image 래스터→로컬 VTracer 계약으로 갱신한다.
- `docs/api-spec/worker-motifs.md`, `worker-pipeline.md`, `db/MAPPING.md`,
  `docs/specs/worker-refactor.md`, 미실행 `motif-metadata-enrichment.md`의 현행 provider와
  일반 예산 명칭을 맞춘다. 완료된 reviews의 역사 기록은 고치지 않는다.
- 개인정보처리방침은 Recraft 항목을 제거하고 OpenAI 처리 목적에 “사용자가 명시적으로
  요청한 새 모티프 생성 프롬프트”를 포함한다. 사용자 업로드 이미지가 OpenAI로
  전송되지 않는 현재 계약은 유지한다.
- `docs/OPERATOR-CHECKLIST.md`와 `docs/CHECKLIST.md`의 secret·스테이징·국외 처리
  항목을 OpenAI 단일 provider 기준으로 바꾼다.

## 5. 검증과 컷오버 순서

1. **회귀 테스트부터 교체**
   - GPT Image HTTP payload가 `gpt-image-2/low/1024x1024/n=1`인지 확인.
   - prompt 안전 여백, 최대 6 전경색, canvas frame, gate 재시도 1회 고정.
   - resolver가 `source='gpt_image'`, pending, provenance를 보존하는지 확인.
   - 미구성/429·5xx/invalid base64/초과 PNG/2회 gate 실패의 안전한 오류 확인.
2. **DB/API 계약 검증**
   - 빈 PostgreSQL에서 baseline→현재 head upgrade와 `alembic check` 통과.
   - 공식 seed 전체를 두 번 실행해 새 `seed-*` ID로 멱등인지 확인.
   - DB schema, seed 결과, source 집합에 `recraft`가 없음을 확인.
   - API 예산 3회/4회째 409/worker 실패 환급 테스트를 새 필드·code로 통과.
   - `pnpm codegen` 후 codegen drift 없음.
3. **정적·전체 회귀**
   - `pnpm lint`
   - `pnpm turbo build typecheck test`
   - `uv run pytest`
   - `uv run ruff check .`
   - `uv run pyright`
4. **스테이징 smoke**
   - `OPENAI_API_KEY`만 주입된 generate worker에서 한국어 subject로 모티프 1건 생성.
   - `gpt-image-*`, `source=gpt_image`, `pending`, 사방 여백·비율·색 보존 확인.
   - 요청 세션 exact ID 즉시 렌더, 타 사용자 검색 제외, admin 승인 후 검색 노출과
     registry fingerprint 변경 확인.
   - 생성 실패 시 세션 예산 환급, 성공 시 1회 차감 확인.
   - Recraft secret/env/IAM 없이 `/readyz`와 명시적 생성이 정상인지 확인.
5. **마감**
   - 앱·DB 모델/migration·테스트·fixture·golden·설정·IaC·현행 spec에서
     `rg -i recraft`가 0건인지 확인. 언급은 `docs/reviews/`와 git 이력에만 허용한다.
   - Recraft Secret Manager 리소스 제거와 외부 키 폐기를 확인한다.
   - 결과를 `docs/reviews/`에 기록하고 이 플랜을 삭제한다.

## 완료 기준

- 명시적 모티프 생성이 GPT Image 2 low만 호출하며 Recraft 코드나 fallback이 없다.
- 새 생성 행은 `gpt-image-*`, `source='gpt_image'`, `pending`이다.
- schema, seed, 테스트 fixture/golden, API client, 런타임과 IaC에 Recraft 명칭이나
  compatibility 분기가 없다.
- 10% 생성 여백과 canvas frame 보존으로 원본 캔버스 내 비율이 유지된다.
- 세션 예산·환급·승인 게이트·검색 격리 계약이 provider 교체 전과 동일하다.
- Alembic, OpenAPI client, store/admin, IaC, 개인정보처리방침과 운영 문서가 같은 명칭을 쓴다.
- Recraft secret과 외부 credential이 제거돼 있다.

## 롤백

- Recraft 코드·schema·credential은 롤백 대상으로 보존하지 않는다.
- 전환 중 실패하면 GPT Image 경로를 고쳐 forward한다. DB는 빈 baseline bootstrap을
  다시 실행하고, 외부 호출이 필요한 seed는 공식 멱등 스크립트로 재생성한다.
- Recraft 재도입은 롤백이 아니라 새 provider 도입으로 취급하며 별도 플랜과 파일럿이
  필요하다.

## 하지 않는 것

- GPT Image/Recraft 선택 UI·feature flag·fallback.
- Recraft ID/source를 읽는 compatibility alias, 데이터 변환기, dual-read.
- 모티프 검색 τ, 임베딩 모델, 승인 정책, 세션당 3회 예산 변경.
- 사용자 업로드 사진을 OpenAI에 전송하거나 생성 이미지 원본을 DB/GCS에 새로 보관.
- 파일럿을 다시 유료 실행. 전환 검증은 기존 20건 근거 + 스테이징 smoke 1건으로 제한한다.

## 상태 — 계획
