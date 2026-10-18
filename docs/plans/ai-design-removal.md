# AI 디자인 전면 제거 — 실사화·토큰·저작·모티프 생성/검색·임베딩

2026-10-18 store 색·로고 화면의 "생성 · 200토큰"을 **바로 주문하기**로 바꿨다. 이제 꾸민 디자인은
화면에서 PNG로 만들어 맞춤 주문의 참고 이미지로 첨부된다(`apps/store/src/pages/design/customize.tsx`
`order()`, `apps/store/src/features/design/model/svg-preview.ts` `svgToPngFile`). 이 변경으로 AI 디자인
전체가 고객 흐름에서 빠졌다. admin의 렌더 로그·무늬·템플릿 화면은 남기되 이름을 바꾸고 AI 부분만 걷어낸다.
이 플랜은 그 결과 쓰이지 않게 된 코드·스키마·GCS 산출물·인프라·문서·법적 고지를 **전부** 지운다.
결정 사항은 2026-10-18에 확정됐다(아래). 고지·시행일은 2026-10-19이다.

## 왜 필요한가

- 고객 흐름은 `템플릿 고르기(/design) → 색·로고(/customize) → 바로 주문하기(/custom-order)`뿐이다.
  실사화(finalize), 토큰 과금·구매·환불, LLM 저작(DesignPlan v3), 모티프 검색·생성, 임베딩, few-shot/RAG,
  아이디어 제안은 호출하는 화면이 없다.
- 그런데 OpenAI 키, `worker-finalize` Cloud Run, 스케줄러 배치 2종, pgvector 컬럼, 토큰 판매 페이지가 아직
  살아 있다. 비용과 공격면이 남고, 개인정보처리방침(OpenAI 국외이전)·약관(디자인 토큰)이 실제 서비스와
  달라진다(법적 고지 불일치).

## 결정 사항 (2026-10-18 확정)

- **D1 토큰:** 유료 결제자는 0명이다. 토큰 판매·사용·환불을 **전부 즉시 제거**한다. 환불 경로는 남기지 않는다.
  환불정책 §11의 토큰 조항도 삭제한다.
- **D2 이력:** 무료 토큰 사용자만 있어 금전 가치가 없다. `generation_jobs`·`token_works`·`design_tokens`·
  `token_purchases`·`authoring_examples`·`authoring_promotion_candidates`를 전부 DROP한다.
  `orders`에 `order_type='token'` 행이 있으면 데이터 마이그레이션으로 함께 지운다(Phase 4).
  `seamless_generation_logs`는 렌더 로그로 남긴다. AI 경로가 남긴 행·AI 전용 컬럼만 지운다(Phase 4).
- **D3 GCS:** finalize 산출물(`fabric/`·`tile/` 접두)을 전부 삭제한다. `uploads/` 아래 주문 참고 이미지는
  주문에 복사된 별도 객체라서 유지한다.
- **D4 고지:** 개인정보처리방침·약관·환불정책의 변경 공지 게시일과 시행일은 **2026-10-19**로 한다.
- **admin 화면 — 남기고 이름 바꾸기:**
  - "Seamless 로그" → **"디자인 렌더 로그"**(`pages/generation/seamless-*`).
  - "모티프 SVG" → **"무늬·로고"**(`pages/motifs/*`).
  - "디자인 예시" → **"템플릿"**(`pages/design-examples/list.tsx`).

  라우트 경로(`/seamless-logs`·`/motifs`·`/design-examples`)와 api 경로(`/admin/generation/seamless*`·
  `/admin/motifs*`·`/admin/design-examples*`)는 **그대로 둔다**. admin 북마크와 api-client 이름을 흔들 이유가 없고,
  바뀌는 건 사람이 보는 이름뿐이다.
- **admin 화면 — 지우기:** "생성 작업"(`pages/generation/jobs-list`·`job-detail`과 generation_jobs admin API),
  "few-shot 후보"·"few-shot 시범"(`pages/authoring/*` 전체와 `/admin/authoring` API).
- **템플릿 등록(`pages/design-examples/new.tsx`):** **지운다.** Seamless 로그의 생성 run(`run_id`)을 갤러리 예시로
  등록하는 화면이다(`new.tsx:52` 설명, api `create_admin_design_example` → `_resolve_design_run`). 템플릿은 이제 시드 코드
  (`seed_design_examples.py`)로만 만든다. 목록의 게시·순서·삭제(`PATCH`·`DELETE`)는 남긴다.
- **무늬 검토(`reviewAdminMotif`):** **지운다.** `POST /admin/motifs/{id}/review`(`admin/generation.py:1302`)는
  `user_upload`가 아닌 행의 `status`를 바꾼다. 그 `status=approved`를 읽는 곳은 worker `motifs/store.py:207,240,262,326,343,358`뿐이다.
  모두 카탈로그 검색·임베딩 경로(AI)라서 Phase 3에서 사라진다.
- **worker 에셋 스크립트(grep으로 판단):**
  - `extract_tie_assets.py`·`extract_tie_flat_assets.py`는 **남긴다**. store·admin `public/images/`의 넥타이 마스크·명암
    에셋을 만드는 스크립트이고, `packages/shared/src/components/tie-canvas.tsx:71,101,130,160`이 그 출력값을 참조한다.
    `extract_tie_assets.py`의 입력 `apps/worker/src/worker/render/assets/photo/tie-base.png`도 남긴다.
  - `export_weave_swatches.py`는 **지운다**. 출력 `apps/store/public/images/weaves/`를 참조하는 코드가 없다
    (`git grep images/weaves` 결과는 스크립트 자신뿐). 출력 폴더와 입력 `render/assets/fabric/*.png`도 같이 지운다.

## 남기는 것 (이것만 — 각 항목 grep으로 확인함)

- 시드: `apps/worker/scripts/seed_motifs.py`, `apps/worker/scripts/seed_design_examples.py`, `.claude/skills/tie-template`,
  넥타이 에셋 스크립트 `extract_tie_assets.py`·`extract_tie_flat_assets.py`(+ `render/assets/photo/tie-base.png`).
- 템플릿 API(`apps/api/src/api/domains/design/examples.py`):
  - 공개: `GET /design/examples`(`list_design_examples`), 템플릿 세션 생성(`create_design_session_from_example`).
  - admin(`admin_router`): 목록·수정(게시·순서)·삭제와 `_admin_out`·`_example_or_404`. 생성(`POST`)만 지운다.
  - 공유 헬퍼 `_example_out`·`_examples_with_preview`·`_preview_svg`·`_design_intent`·`_colorways`·`_logo_slot_motif_id`.
    공개 목록과 admin 목록이 함께 쓴다.
- admin 화면(이름만 바꿈): 디자인 렌더 로그(`pages/generation/seamless-list.tsx`·`seamless-detail.tsx`), 무늬·로고
  (`pages/motifs/list.tsx`·`detail.tsx`), 템플릿(`pages/design-examples/list.tsx`).
  api `domains/admin/generation.py`의 seamless 목록·상세·통계(`/generation/seamless*`)와 motif 목록·상세·수정(`/motifs*`)도 남긴다.
  `pages/generation`의 공용 파일은 렌더 로그·무늬 화면이 import하는 것만 남긴다:
  `shared.tsx`·`generation-labels.ts`(seamless-list·detail), `safe-svg-preview.tsx`(seamless-detail·motifs/detail).
  `job-status.ts`는 jobs 화면 전용이라 지운다(실행 시 grep으로 재확인).
- 렌더 로그 기록: `seamless_generation_logs` 테이블, worker `/generate`의 `_logged_generation`(`api/routes.py:189`).
- 결정론 엔진·렌더: `apps/worker/src/worker/engine/*`, worker `/generate`의 **intent 경로**
  (`api/routes.py` `_generate_from_intent`), `render/raster.py`·`segment.py`. 템플릿 세션 생성과 로고 교체 재렌더가 쓴다.
- 로고 경로: `POST /design/sessions/{id}/logo`(`router.py` `place_design_logo`) → `import_user_motif` →
  `_activate_motif_slot`, worker `/motifs/import`, `user_motifs`. 사진→로고 `POST /design/motifs/photo-preview` →
  worker `/motifs/photo-preview`(`motifs/photo_svg.py`, 로컬 VTracer — OpenAI 안 씀), 업로드 `design_reference` kind.
- 세션: `design_sessions`, `design_session_turns`(로고 교체가 `_append_turn`으로 턴을 남긴다),
  `GET /design/sessions/{id}`, `GET /design/sessions`(store `use-example-start.ts`가 무효화에 쓴다).
- `motifs`·`design_examples` 테이블 행(시드가 채우고 템플릿이 참조한다). `motifs`의 임베딩 컬럼만 지운다.
- GCS `uploads/` 아래 주문 참고 이미지.

## 범위 밖

- 템플릿 엔진 정확도 개선, 새 템플릿 추가.
- 맞춤 주문 결제·견적 로직 변경. 참고 이미지 업로드 경로는 그대로 둔다.

## 실행 조건

- 바로 주문하기 변경(브랜치 `feat/et`)이 main에 머지·배포됐고, 운영에서 주문 → admin 참고 이미지 표시를 확인했다.
- 실행하면 안 되는 때: 운영에 진행 중인 생성이 있을 때(`active_generation_id`가 채워진 `design_sessions` 행이 있을 때).
  `select count(*) from design_sessions where active_generation_id is not null`이 0이 될 때까지 기다린다.

## 절차

각 Phase는 따로 PR로 낸다. 순서를 지킨다. 화면을 먼저 끊고, 그다음 api, 마지막에 스키마를 지운다.

### Phase 1 — store·admin 화면 (api 변경 없음)

1. store 토큰 구매·내역·환불: 아래 파일과 라우트를 지운다.
   - `src/pages/token-purchase/*`(index·payment·success·fail), `src/pages/my-page/token-history.tsx`,
     `features/claims/ui/token-refund-section.tsx`
   - 라우트 `src/app/router/index.tsx:73,153,160,167,213`
   - 마이페이지·클레임 화면의 토큰 진입점(`pages/my-page/index.tsx`·`claims.tsx`·`claim-detail.tsx`, `features/claims/model/config.ts`)

   옛 토큰 주소는 `/`로 redirect한다(`/color` 패턴 재사용).
2. store 잔여 AI UI:
   - `features/design/ui/finalized-gallery.tsx`(+test), `view-toggle.tsx`를 지운다(사용처 0, grep 확인).
   - `features/design/model/queries.ts`의 `latestFinalizedJobQueryOptions`·`finalizedJobsInfiniteQueryOptions`를 지운다.
     active-generation 폴링은 로고 교체 대기에 필요한지 확인하고, 필요 없으면 지운다.
   - `features/design/api/context-tools.ts` `previewTextMotif`, `shared/lib/live-queries.ts` `tokenBalanceQueryOptions`를 지운다.
   - `shared/store/session.ts`·`features/auth/model/bootstrap-session.ts`·`app/providers/auth-provider.tsx`의 토큰 잔액 처리를 지운다.
3. store 결제·주문 공용 코드에서 토큰 주문 분기를 **지운다**: `features/checkout/model/use-checkout-payment.ts`·
   `use-payment-confirm.ts`, `features/orders/model/display.ts`, `pages/my-page/orders.tsx`.
   토큰 주문 행은 Phase 4에서 지우므로 표시 분기도 남기지 않는다.
4. store 문구:
   - `pages/faq/model/faq-data.ts`: "AI 디자인" 카테고리(136-160)를 지운다.
   - `pages/notice/model/notice-data.ts:94`: 토큰 공지를 지우고, 2026-10-19 변경 고지를 새로 넣는다.
   - `features/home/hero.tsx:31`, `features/home/lookbook.tsx:48`: "AI 디자인 생성" 문구를 바꾼다.
   - `pages/refund-policy/index.tsx`: §11 "디자인 토큰과 디지털 서비스"(112-117)와 19·140행 설명의 토큰 언급을 지운다.
   - `pages/terms-of-service/index.tsx`: 정의 30행, §10 "AI 디자인과 디자인 토큰"(101), 19·164 설명문을 고친다.
   - `pages/privacy-policy/index.tsx`: 목적 27행, 처리위탁·국외이전의 OpenAI 항목 83·98을 지운다.
     시행일 157을 2026년 10월 19일로 바꾼다. 사업자 표기는 `영선산업`·`ESSE SION`을 유지한다.
5. admin 화면 — 삭제:
   - `pages/authoring/*` 전체, `pages/generation/jobs-list.tsx`·`job-detail.tsx`·`job-status.ts`(+tests),
     `pages/design-examples/new.tsx`를 지운다. 라우트는 `app/router/router.tsx:278-338,357-362`에서 지운다.
     사이드바 항목 "생성 작업"·"few-shot 후보"·"few-shot 시범"은 `shared/config/navigation.ts:60-74`에서 지운다.
     템플릿 목록의 "등록" 버튼도 지운다.
6. admin 화면 — 이름 바꾸기와 AI 부분 걷어내기(경로는 그대로):
   - `shared/config/navigation.ts:53-80`:
     - 그룹 "생성·에셋"을 "디자인"으로 바꾼다.
     - "Seamless 로그"를 "디자인 렌더 로그", "모티프 SVG"를 "무늬·로고", "디자인 예시"를 "템플릿"으로 바꾼다.
     - `widgets/admin-shell/admin-sidebar.test.tsx`를 맞춘다.
   - 렌더 로그(`pages/generation/seamless-list.tsx:348,352,355,383`, `seamless-detail.tsx`의 RouteHeading·문서 title):
     - "Seamless 로그/통계" 문구를 "디자인 렌더 로그/통계"로 바꾼다.
     - 프롬프트 표시(`prompt`·`has_prompt`), 토큰 정산(`token_accounting`), LLM·RAG 진단(authoring 시도·선택 예시·
       motif_resolutions·plan/compiler/prompt revision)을 지운다.
     - 입력 방식 필터·표시는 `prompt`가 사라져 `intent` 하나만 남는다. 필터를 지우고 표시만 남긴다.
     - `generation-labels.ts`에서 AI 경로만 내는 값을 지운다(worker `api/routes.py`에서 grep으로 확인함):
       - `GENERATION_MODE_LABELS`의 `prompt`·`patch`, `PATCH_AXIS_LABELS` 전체
       - `INPUT_TYPE_LABELS.prompt`
       - `FAILURE_STAGE_LABELS`의 `authoring`·`motif_resolution`
       - `FAILURE_CODE_LABELS`의 `authoring_invalid`·`scope_rejected`·`semantic_mismatch`·`provider_request_failed`

       남는 값: 모드 `variation`·`motif_slot`, 단계 `constraints`·`intent`·`design`, 코드 `constraint_conflict`·
       `intent_invalid`·`design_invalid`. 이들은 `_generate_from_intent`(`routes.py:365-419`)가 내는 것이다.
     - `seamless-list.test.tsx`·`seamless-detail.test.tsx`를 맞춘다.
   - 무늬·로고(`pages/motifs/list.tsx`·`detail.tsx`):
     - 제목 "모티프 상세"(`detail.tsx:228,231`)를 "무늬·로고 상세"로 바꾼다.
     - "카탈로그 검토"(`MotifReviewActions`, `detail.tsx:245-`)와 검토 상태 표시·필터를 지운다.
     - "검색 메타데이터" 카드의 `description`·`tags` 편집(`detail.tsx:83-175`)과 태그 표시(`:473-`)를 지운다.
       `subject`(이름)·`style` 편집은 남긴다.
     - 목록의 `status` 필터를 지운다. 출처(`seed`·`user_upload`·`gpt_image`) 표시는 남긴다.
   - 템플릿(`pages/design-examples/list.tsx`):
     - RouteHeading·문구의 "디자인 예시"를 "템플릿"으로 바꾼다.
     - "첫 진입 갤러리 예시" 서술을 "스토어 템플릿 목록"으로 바꾼다.
     - `list.test.tsx`를 맞춘다.
7. admin 화면 — 그 밖의 정리:
   - `pages/pricing.tsx`: 토큰 플랜 섹션을 지운다.
   - `pages/settings.tsx`: `design_*_cost`·`design_token_initial_grant`·OpenAI 렌더 단가 입력을 지운다.
   - `pages/customers/detail.tsx`: 토큰 잔액·수동 지급을 지운다.
   - `pages/dashboard.tsx`: 토큰·생성 지표를 지운다.
   - `pages/orders/*`·`pages/claims/*`·`shared/lib/format.ts`·`shared/ui/status-badge.tsx`의 토큰 주문·토큰 환불 분기를 지운다.
8. 검증: `pnpm lint && pnpm build && pnpm typecheck && pnpm test`, `pnpm architecture:check`.
   browser-use로 store 헤더·마이페이지·FAQ·약관·환불정책을 확인하고, admin 사이드바에 죽은 링크가 없는지, "디자인" 그룹에 렌더 로그·무늬·로고·템플릿 세 항목만 남았는지 본다.

### Phase 2 — api 엔드포인트 + 명세 + api-client (돈 경로)

1. `apps/api/src/api/domains/design/router.py`에서 지운다:
   - 엔드포인트: `text-preview`·`ideas`·`motifs`(GET list·DELETE)·`POST /design/sessions`(빈 세션)·`turns` GET/POST·
     `/design/generate`·`steps/activate`·`/design/export`·`finalize`·`/design/jobs*`·`order-reference`·
     `motifs/search`·`motifs/generate`·`motifs/activate`·`/color`(store 사용처 0 — 2026-10-18 삭제).
   - 딸린 헬퍼: `_run_finalize`, `_order_reference_sources`, `_generation_job_out`, `_build_conversation_context`,
     `_resolve_design_run`, `_dispatch_generation`, `_dispatch_motif_generation`, `_save_generated_motif`, `_motif_results` 등.
   - 남기는 것: `_activate_motif_slot`, `_dispatch_motif_activation`, `_start_generation`,
     `_finish_generation_success/failure`, `_append_turn`, `_recover_stale_active_generation`.
     이 함수들에서 `charge_cost`·토큰 차감·환불 인자를 걷어 **무과금 재렌더 전용**으로 줄인다(지금도 `charge_cost=0`).
     `_finish_generation_success`가 `generation_jobs`를 쓰면 그 기록도 걷어낸다(Phase 4에서 DROP).
     렌더 로그(`seamless_generation_logs`)는 worker가 쓰므로 여기서 건드리지 않는다.
2. `domains/design/examples.py`: 생성 `create_admin_design_example`(`:286-`)와 그 요청 스키마
   `AdminDesignExampleCreateRequest`를 지운다. 1에서 지우는 `_resolve_design_run`의 마지막 사용처다.
   목록·수정·삭제와 공유 헬퍼는 남긴다(위 "남기는 것").
3. `domains/tokens/*`를 통째로 지운다(ledger·work·router·schemas — balance·history·plans·orders·refundable-orders·
   refund-requests). `main.py:371` include도 지운다. `/admin/tokens/manage`·`/admin/token-refunds/{id}/approve`
   (`domains/admin/router.py`·`claims_router.py`)와 클레임 서비스의 토큰 환불 분기도 지운다.
4. `domains/payments/service.py`: 토큰 주문(`_token_order_amount:126`, `_grant_purchased_tokens:714`,
   `_claw_back_purchased_tokens:1167`과 호출부 538·651·1121)과 주문 생성의 `order_type="token"` 분기를 지운다.
5. admin api:
   - `domains/admin/authoring.py`(`/admin/authoring`)와 `main.py:384` include를 지운다.
   - `domains/admin/generation.py`는 **부분 삭제**한다:
     - generation_jobs 3종(`/generation/jobs/stats`·`/generation/jobs`·`/generation/jobs/{id}`, `:515-705`)과
       `finalize_duration_seconds`·`_job_*`·`_parameter_summary`·`_result_url`
     - `_generation_token_accounting`(`:1038`)과 seamless 상세의 `token_accounting`
     - seamless 응답의 `prompt`·`has_prompt`와 LLM·RAG 진단 필드(`_safe_diagnostics`의 authoring·resolution 부분), `_safe_patch`
     - motif 검토 `POST /motifs/{id}/review`(`:1302`)와 `MotifReviewRequest`
     - `MotifUpdateRequest`의 `description`·`tags`와 수정 시 `embedding_openai = None` 초기화

     seamless 목록·상세·통계와 motif 목록·상세·수정(`subject`·`style`)은 남긴다.
   - `configuration.py`의 토큰·OpenAI 단가 설정을 지운다.
6. 배치: `domains/batch/router.py`의 `/authoring-promotion-candidates`·`/recover-token-works`를 지운다.
7. 설정: `apps/api/src/api/config_defaults.py:27-35`(`design_*` 단가·초기 지급·`_RETIRED_ADMIN_SETTING_KEYS`),
   `:69-75`(토큰 플랜), `config.py`의 worker finalize URL·audience를 지운다.
   회원가입·로그인의 초기 토큰 지급 호출부(`git grep design_token_initial_grant`)도 지운다.
8. 명세 갱신(같은 PR, 대원칙):
   - `docs/api-spec/money.md`: §6 "토큰 원장·플랜·환불"을 삭제하고, 제목·§1·§5·§9의 토큰 언급을 지운다.
   - `docs/api-spec/domains.md`: §11 디자인 엔드포인트를 남는 표면(examples 공개 2종·세션 조회·logo·photo-preview)으로
     줄이고, §4 클레임·§10 admin의 토큰·모티프·디자인 예시 항목을 지운다.
   - `docs/api-spec/authoring-plan-v3.md`·`design-evaluation.md`는 삭제한다.
9. `pnpm codegen` 후 `packages/api-client` 생성물을 같은 커밋에 넣는다(CI codegen-drift).
10. 테스트:
    - 삭제: `apps/api/tests/test_admin_authoring.py`·`test_tokens.py`·`test_token_adjustment_safety.py`
    - 남는 동작만 남김: `test_admin_generation.py`(seamless·motif 목록·상세·수정), `test_design.py`(템플릿 목록·세션 생성·
      로고·photo-preview·admin 템플릿 수정·삭제), `test_payments.py`, `test_admin_management.py` 인가 테스트는 testcontainers를 유지한다(mock 금지).
11. 검증: `uv run pytest apps/api/tests/test_design.py apps/api/tests/test_payments.py apps/api/tests/test_admin_generation.py`,
    `uv run ruff check . && uv run pyright`, `pnpm codegen && git diff --exit-code packages/api-client`.
    로컬에서 템플릿 → 로고 → 바로 주문하기 → 주문 제출을 끝까지 실행한다(Toss DryRun).

### Phase 3 — worker

1. `apps/worker/src/worker/api/routes.py`에서 지운다: `/generate`의 `_generate_from_patch`·`_generate_from_prompt` 분기와
   그 LLM·RAG 진단, `/motifs/candidates`·`/ideas`·`/motifs/generate`·`/motifs/text-preview`·`/export`·`/finalize`(`finalize_router`).
   남기는 것: `/generate`(intent)와 `_logged_generation`(렌더 로그), `/motifs/photo-preview`, `/motifs/import`.
   `_logged_generation`(`:189-`)의 `mode` 판정에서 `patch`·`prompt` 갈래를 지우고, `motif_resolutions` 진단도 지운다.
   `input_type`은 `"intent"`로 고정하고 `prompt=` 기록을 지운다.
2. 모듈 삭제(각각 intent 렌더·photo-preview·import가 import하는지 grep으로 확인한다):
   - `adapters/{llm,embedding,gpt_image,motif_tagging,motif_intent}.py`(`named_colors.py`는 사용처 확인)
   - `authoring/*` 전체
   - `render/{photoreal,fabric,inlay,materials,motif_mask,weave}.py`, `render/assets/fabric/`
     (`render/assets/photo/tie-base.png`는 남긴다 — `extract_tie_assets.py`의 입력)
   - `motifs/{embeddings,resolver,tagging,text_svg,categories}.py`, `motifs/store.py`의 검색 부분
   - `config.py`의 OpenAI·임베딩·`SERVICE_MODE=finalize` 설정, `integrations.py`의 어댑터 조립
3. 스크립트:
   - 삭제: `apps/worker/scripts/{backfill_motif_tags,calibrate_photoreal,collect_design_accuracy,eval_authoring,
     eval_design_accuracy,index_motif_embeddings,seed_authoring_examples,export_weave_swatches}.py`,
     `{authoring_prompts,design_accuracy_cases,gallery_eval_prompts}.json`, `apps/store/public/images/weaves/`
   - 고침: `seed_motifs.py`에서 OpenAI 메타데이터·임베딩 호출을 지운다(시드 행만 넣게).
   - 유지: `seed_design_examples.py`, `extract_tie_assets.py`, `extract_tie_flat_assets.py`
4. 테스트: `apps/worker/tests/`의 `test_adapters`·`test_authoring_*`·`test_finalize_jobs`·`test_photoreal`·
   `test_motif_resolver`·`test_motif_tagging`·`test_motif_store`(검색 부분)은 삭제한다.
   `test_generation_logging`은 intent 경로 기록만 남긴다.
   `test_api_motifs`(import·photo-preview 케이스만)·`test_config`는 정리한다.
5. 명세: `docs/api-spec/worker-motifs.md` §3(GPT Image 부분)·§4·§5·§6·§7.2를 지운다(§7.1 사진→SVG는 남긴다).
   `worker-pipeline.md` §2(finalize)·§3(weave 에셋)을 지운다. `worker-engine.md`는 남긴다.
6. 검증: 남는 테스트 파일만 지정해 `uv run pytest`를 돌린다. `uv run ruff check . && uv run pyright`,
   `pnpm architecture:check`(import-linter 계약)를 돌린다. 로컬 worker를 재시작한 뒤
   (`--reload` 없이 떠 있으면 옛 코드로 돈다) `seed_design_examples.py`를 재실행하고 로고 교체 재렌더를 확인한다.

### Phase 4 — DB (Alembic 경유만, DDL 직접 실행 금지)

1. 먼저 토큰 주문 행이 있는지 확인한다(로컬·운영 둘 다):
   - 로컬: `docker compose exec -T db psql -U essesion -d essesion -c "select order_type, count(*) from orders group by order_type"`
   - 운영: Cloud SQL에 같은 쿼리를 읽기 전용으로 실행한다(접속 절차는 `infra/README.md`).
   - `token` 행이 있으면 그 주문을 참조하는 행도 센다:
     `order_items`·`order_status_logs`·`claims`·`payment_incidents`·`admin_operation_logs`의 FK 대상.
     FK 대상과 ON DELETE 규칙은 `db/src/db/models/commerce.py`로 확인한다.
2. 새 마이그레이션 `db/migrations/versions/<date>_drop_ai_design.py`를 만든다:
   - 데이터: `order_type='token'` 주문과 그 종속 행을 지운다(FK 순서대로).
     `admin_settings`의 `design_*_cost`·`design_token_initial_grant`·`design_token_cost_openai_render_standard` 행과
     토큰 플랜 `pricing_constants` 행을 지운다. seed-config는 수동이라 운영 DB가 따라오지 않으므로 반드시 마이그레이션으로 한다.
   - 제약: `orders.order_type` CHECK(`commerce.py:209`)에서 `'token'`을 뺀다.
   - 스키마: `generation_jobs`·`token_works`·`design_tokens`·`token_purchases`·`authoring_examples`·
     `authoring_promotion_candidates`를 DROP한다. `design_turn_attachments`는 남는 코드가 쓰는지 확인하고, 안 쓰면 DROP한다.
   - 렌더 로그 `seamless_generation_logs`(`db/src/db/models/seamless.py:214-`):
     - 데이터: `input_type='prompt'` 행과 `diagnostics->>'mode' = 'patch'` 행(AI 경로가 남긴 것)을 지운다.
     - 컬럼: `prompt`만 AI 경로(`routes.py:226`)가 쓴다. 지운다. CHECK `input_type IN ('intent','prompt')`는 `('intent')`로 줄인다.
     - 남는 컬럼: `request_id`·`session_id`·`user_id`·`input_type`·`colorway`·`seed`·`engine_version`·`registry_version`·
       `intent`·`design`·`warnings`·`generate_ms`·`render_ms`·`status`·`error_*`·`diagnostics`. intent 경로가 계속 쓴다.
       실행 시 Phase 3 이후 `routes.py`를 다시 grep해서 확인한다.
   - `motifs`:
     - `embedding_openai` 컬럼과 `ix_motifs_embedding_openai_hnsw`를 지운다.
     - `status`·`reviewed_at`·`reviewed_by`와 CHECK: Phase 2·3 뒤 `git grep -n "Motif.status\|reviewed_at"`가 0건이면 지운다.
     - `description`·`tags`: 남는 읽기 사용처가 없으면(`router.py` `_motif_label`은 Phase 2에서 지워진다) 지운다.
       `seed_motifs.py`의 쓰기도 함께 지운다.
   - `vector` 확장: 다른 사용처가 없으면 DROP EXTENSION한다(down에서 되살린다).
3. 모델: `db/src/db/models/seamless.py`(motif 임베딩·검토 컬럼, authoring 2개 모델, 렌더 로그 `prompt` 컬럼), `design.py`(`generation_jobs`),
   `tokens.py`(파일 삭제)를 정리한다. `db/pyproject.toml`의 `pgvector`는 사용처가 0이면 제거한다.
4. `db/README.md`의 임베딩·토큰 원장 설명을 지운다.
5. 검증:
   - `uv run alembic -c db/alembic.ini upgrade head` → `downgrade -1` → `upgrade head`를 로컬에서 왕복한다.
   - `\d motifs`로 임베딩 컬럼이 없어졌는지 본다. 위 `order_type` 쿼리에 `token`이 없는지 본다.
   - `select key from admin_settings`로 키가 지워졌는지 본다.
   - 시드 재실행(`seed.py`·`seed_motifs.py`·`seed_design_examples.py`)이 성공하는지 본다.

### Phase 5 — GCS·인프라·시크릿 (사람이 apply)

1. GCS: assets 버킷의 `fabric/`·`tile/` 접두 객체를 전부 지운다. 먼저 목록·개수를 확인한다.
   `uploads/`는 건드리지 않는다. 로컬은 fake-gcs-server에서 같은 접두를 지운다.
   운영 삭제 명령과 버킷명은 `infra/README.md`·`assets_bucket_name` 설정으로 확인하고, 사람이 실행한다.
2. `infra/cloudrun.tf`에서 지운다: `worker_finalize` 서비스(291-), invoker IAM(393-), api env `WORKER_FINALIZE_*`(16-17),
   `worker_finalize_plain_env`(58), OpenAI 키 주입(60-65). 동시 커넥션 예산 주석(10)은 고친다.
3. `infra/secrets.tf`·`iam.tf`: `openai-api-key` 시크릿과 `worker_finalize` SA·바인딩을 지운다.
4. `infra/scheduler.tf:17-18`: `authoring-promotion-candidates`·`recover-token-works`를 지운다.
5. `infra/monitoring.tf`: finalize·OpenAI 알림을 grep으로 찾아 정리한다. `infra/README.md`도 고친다.
6. `.env.example:4` `OPENAI_API_KEY`와 `.github/workflows/deploy.yml`의 worker-finalize 배포 단계를 지운다(grep 확인).
7. OpenAI 대시보드에서 키를 폐기한다(사람).
8. 검증: `terraform plan`의 diff가 위 항목뿐인지 본다. 배포 후 api `/readyz`, 템플릿 → 로고 → 주문을 확인한다.

### Phase 6 — 문서·README·하네스

1. `README.md`: "왜 채팅으로 먼저 잡고, 이미지는 마지막에 만드는가"(49), Design engine(74), 결과 요약·사용자 경험·
   Admin·로컬 실행의 OpenAI·토큰·디자인 관리 서술을 템플릿 → 색·로고 → 주문 흐름으로 다시 쓴다.
2. `ARCHITECTURE.md`: §1.1 컨테이너(worker-finalize 삭제), §1.2, §2.2 Cloud Run 리소스, §3.4 주문·결제 흐름(토큰 주문),
   §5.2 데이터 그룹, §6.1 "AI와 엔진의 경계"(AI 쪽 삭제), §7 배치를 고친다.
3. `AGENTS.md`:
   - 명령어에서 `backfill_motif_tags`·`index_motif_embeddings`·`seed_authoring_examples`와 "`OPENAI_API_KEY` 필요" 문구를 지운다.
     시드 순서는 `seed.py → seed_motifs.py → seed_design_examples.py`로 줄인다.
   - 도메인 규칙의 "토큰 과금" 문장을 고친다.
4. `docs/analytics.md:35,66-67`: `token_purchase` 이벤트를 폐기 표기한다. 계측 코드(`git grep token_purchase apps`)도 지운다.
5. `docs/plans/token-pricing-recalibration.md`·`docs/plans/design-accuracy-followups.md`는 전제가 사라졌으니 삭제한다.
   `docs/plans/offbeat-logo-large-tile.md`는 엔진 쪽이면 남긴다(내용 확인).
6. `docs/reviews/`의 AI 관련 기록은 역사라서 남긴다. 지운 문서로 가는 깨진 링크만 고친다(`pnpm architecture:check`가 잡는다).
7. `packages/shared/AGENTS.md`·`apps/store/src/shared/ui/AGENTS.md`의 `ActionButton variant="ai"`("디자인 페이지 실사화 전용") 행:
   사용처가 0이면 variant와 표 행을 함께 지운다.
8. 에이전트 메모리(`~/.claude/projects/-Users-gimbongseob-git-essesion/memory/`) 중 few-shot·임베딩·OpenAI 전환·
   "생산은 타일+실사화"·customer 토큰 지급 항목을 지우거나 고친다.
9. 실행 결과를 `docs/reviews/ai-design-removal-<date>.md`에 기록하고 이 플랜을 지운다.
10. 검증: `pnpm architecture:check`(문서 링크 gate), `pnpm lint`.

## 검증 (전체)

- 운영: 템플릿 → 색 변경 → 로고(SVG·사진) → 바로 주문하기 → 결제 → admin 주문 상세에 참고 이미지가 보인다.
- `git grep -ni openai -- ':!docs/reviews'`가 0건이다.
- `git grep -nE "finalize|token_work|design_token|authoring|embedding_openai" -- apps packages db infra`가 0건이다
  (마이그레이션 이력 파일은 제외).

## 되돌리는 법 / 상향 신호

- Phase 2–4는 돈 경로·스키마 변경이다. PR 단위로 revert하고, 마이그레이션은 `downgrade -1`로 되돌린다.
  DROP한 데이터는 down으로 복구되지 않는다. 운영에서는 Phase 4 직전에 대상 테이블을 `pg_dump -t`로 한 번 떠 둔다.
  GCS 삭제(Phase 5.1)는 되돌릴 수 없다.
- 되돌릴 신호: 배포 뒤 결제 확정·클레임 5xx, 과거 주문 목록·상세 렌더 실패, 템플릿 세션 생성·로고 교체 재렌더 실패.

## 실패 모드

"AI 전용"이라고 단정한 함수가 사실 로고 교체·템플릿 세션 생성 경로에서 쓰이는 경우다
(`_start_generation`·`_append_turn`·worker `/generate` intent 경로·`render/*`·examples.py 공유 헬퍼).
그러면 남은 유일한 흐름이 깨진다. 각 삭제 전에 grep으로 호출부를 확인하고, Phase 2·3·4 끝마다 로고 교체 e2e를 실제로 돌린다.

## 기각한 대안

- **기능 플래그로 숨기기만:** 키·서비스·법적 고지가 남아 비용과 고지 불일치가 계속된다. AI 재도입 계획이 생기면 재론한다.
- **admin 경로·api 경로도 새 이름으로 바꾸기:** 이름만 바뀌는데 라우트·api-client 이름·테스트가 대량으로 흔들린다.
  이름과 경로가 어긋나 혼란이 생기면 재론한다.
- **토큰 환불 경로를 잔액 0까지 유지:** 유료 결제자가 0명이라 지킬 대상이 없다(D1). 유료 결제가 발견되면 재론한다.
