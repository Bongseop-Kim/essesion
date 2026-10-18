# AI 디자인 전면 제거 — 실사화·토큰·저작·모티프 생성/검색·임베딩

2026-10-18 store 색·로고 화면의 "생성 · 200토큰"을 **바로 주문하기**로 바꿨다. 이제 꾸민 디자인은
화면에서 PNG로 만들어 맞춤 주문의 참고 이미지로 첨부된다(`apps/store/src/pages/design/customize.tsx`
`order()`, `apps/store/src/features/design/model/svg-preview.ts` `svgToPngFile`). 이 변경으로 AI 디자인
전체가 고객 흐름에서 빠졌다. admin의 렌더 로그·무늬·템플릿 화면은 남기되 이름을 바꾸고 AI 부분만 걷어낸다.
이 플랜은 그 결과 쓰이지 않게 된 코드·스키마·GCS 산출물·인프라·문서·법적 고지를 **전부** 지운다.
결정 사항은 2026-10-18에 확정됐다(아래). 고지·시행일은 2026-10-19이다.

2026-10-18 검토(4개 영역 import·호출부 전수 grep)로 아래를 바로잡았다 — 원안은 그대로 실행하면
템플릿 시드·템플릿 세션 시작·로고 교체·admin 빌드·배포가 깨졌다. 고친 근거는 각 항목에 적었다.

## 왜 필요한가

- 고객 흐름은 `템플릿 고르기(/design) → 색·로고(/customize) → 바로 주문하기(/custom-order)`뿐이다.
  실사화(finalize), 토큰 과금·구매·환불, LLM 저작(DesignPlan v3 생성), 모티프 검색·생성, 임베딩, few-shot/RAG,
  아이디어 제안은 호출하는 화면이 없다.
- 그런데 OpenAI 키, `worker-finalize` Cloud Run, 스케줄러 배치 2종, pgvector 컬럼, 토큰 판매 페이지가 아직
  살아 있다. 비용과 공격면이 남고, 개인정보처리방침(OpenAI 국외이전)·약관(디자인 토큰)이 실제 서비스와
  달라진다(법적 고지 불일치).

## 결정 사항 (2026-10-18 확정)

- **D1 토큰:** 유료 결제자는 0명이다. 토큰 판매·사용·환불을 **전부 즉시 제거**한다. 환불 경로는 남기지 않는다.
  환불정책 §11의 토큰 조항도 삭제한다.
- **D2 이력:** 무료 토큰 사용자만 있어 금전 가치가 없다. `generation_jobs`·`token_works`·`design_tokens`·
  `token_purchases`·`authoring_examples`·`authoring_promotion_candidates`·`design_turn_attachments`를 전부 DROP한다.
  토큰 주문(`order_type='token'`)은 0건이다(2026-10-18 사용자 확인). 그래서 주문·클레임 행은 지우지 않고 CHECK만 줄인다(Phase 4).
  무료 토큰은 금전 가치가 없어 고지 기간·보존 의무 문제도 없다.
  `seamless_generation_logs`는 렌더 로그로 남긴다. AI 경로가 남긴 행·AI 전용 컬럼만 지운다(Phase 4).
- **D3 GCS:** finalize 산출물(`fabric/`·`tile/` 접두 — 쓰는 곳은 worker `routes.py:1240-1242` finalize뿐)을 전부 삭제한다.
  `uploads/` 아래 주문 참고 이미지와 intent 렌더의 `previews/`(`routes.py:273`)는 유지한다.
- **D4 고지:** 개인정보처리방침·약관·환불정책 **세 문서 모두** 변경 공지 게시일과 시행일을 **2026-10-19**로 한다.
- **D5 `authoring` → `design_plan`:** 템플릿은 DesignPlan v3로 적혀 있다. 그래서 worker `authoring/schema.py`·`compiler.py`는
  **남기되** 패키지 이름을 `worker/design_plan/`으로 바꾼다(Phase 3.3). LLM 저작이 사라지면 "authoring"은 실제 역할(템플릿 플랜 스키마·컴파일러)과
  어긋나 다음 사람을 헷갈리게 한다. 사용처: `seed_design_examples.py:34,36`, `.claude/skills/tie-template/scripts/render.py:37`·`SKILL.md:35-36`,
  `tests/test_authoring_v3.py`, `test_avoid_layer.py`, `biome.json:16`, `docs/plans/offbeat-logo-large-tile.md:36,64`.
  DB에 남는 값 문자열(`compiler_revision=design-plan-v3.2` 등 렌더 로그 기록)은 바꾸지 않는다 — 과거 로그와 비교가 끊긴다.
- **D6 `motifs.status`:** **남긴다.** `approved_motif_ids`(`motifs/store.py:350-358`)가 `fingerprint.registry_version_for`
  (`fingerprint.py:24`)를 거쳐 intent `/generate`(`routes.py:755`)와 `seed_design_examples.py:1380`의 `registry_version`을 만든다.
  검토 API·화면과 `reviewed_at`·`reviewed_by`만 지운다. 둘은 남는 코드가 쓰지 않는다(Phase 2 뒤 grep으로 재확인).
- **admin 화면 — 남기고 이름 바꾸기:**
  - "Seamless 로그" → **"디자인 렌더 로그"**(`pages/generation/seamless-*`).
  - "모티프 SVG" → **"무늬·로고"**(`pages/motifs/*`).
  - "디자인 예시" → **"템플릿"**(`pages/design-examples/list.tsx`).

  라우트 경로(`/seamless-logs`·`/motifs`·`/design-examples`)와 api 경로(`/admin/generation/seamless*`·
  `/admin/motifs*`·`/admin/design-examples*`)는 **그대로 둔다**. admin 북마크와 api-client 이름을 흔들 이유가 없고,
  바뀌는 건 사람이 보는 이름뿐이다.
- **admin 화면 — 지우기:** "생성 작업"(`pages/generation/jobs-list`·`job-detail`과 generation_jobs admin API),
  "few-shot 후보"·"few-shot 시범"(`pages/authoring/*` 전체와 `/admin/authoring` API).
- **템플릿 등록(`pages/design-examples/new.tsx`):** **지운다.** 렌더 로그의 run(`run_id`)을 갤러리 예시로
  등록하는 화면이다(api `create_admin_design_example`). 템플릿은 이제 시드 코드
  (`seed_design_examples.py`)로만 만든다. 목록의 게시·순서·삭제(`PATCH`·`DELETE`)는 남긴다.
- **무늬 검토(`reviewAdminMotif`):** **지운다.** `POST /admin/motifs/{id}/review`(`admin/generation.py:1302`). 컬럼은 D6.
- **worker 에셋 스크립트:**
  - `extract_tie_assets.py`·`extract_tie_flat_assets.py`는 **남긴다**. `packages/shared/src/components/tie-canvas.tsx:71,101,130,160`이
    그 출력을 참조한다. 입력은 `render/assets/photo/tie-base.png` **하나뿐**이다(`extract_tie_assets.py:20`). 그 파일만 남긴다.
  - `export_weave_swatches.py`는 **지운다**. 출력 `apps/store/public/images/weaves/`를 참조하는 코드가 없다.
    출력 폴더와 입력 `render/assets/fabric/*.png`도 같이 지운다.

## 남기는 것 (이것만 — 각 항목 호출부 grep으로 확인함)

- 시드·스킬: `seed_motifs.py`(고쳐서), `seed_design_examples.py`(고쳐서), `.claude/skills/tie-template`,
  `extract_tie_assets.py`·`extract_tie_flat_assets.py`(+ `render/assets/photo/tie-base.png`).
- store가 실제로 부르는 api(`git grep -w`로 확인한 전부): `listDesignExamples`, `createDesignSessionFromExample`,
  `getDesignSession`, `placeDesignLogo`, `previewPhotoMotif`, `createUploadUrl`(kind `design_reference`·주문용),
  `completeDesignReferenceUpload`(`POST /design-uploads/{id}/complete`, `images/router.py:202` — 사진→로고, `customize.tsx:350`),
  `completeOrderImage`. 맞춤 주문 업로드(`features/custom-order/api/upload.ts`)는 tokens·design을 쓰지 않는다.
- 템플릿 API(`apps/api/src/api/domains/design/examples.py`):
  - 공개: `GET /design/examples`(`list_design_examples`), 템플릿 세션 생성(`create_design_session_from_example`, `:218`이 `_resolve_design_run` 호출).
  - admin(`admin_router`): 목록·수정(게시·순서)·삭제와 `_admin_out`·`_example_or_404`. 생성(`POST`)만 지운다.
  - 공유 헬퍼 `_example_out`·`_examples_with_preview`·`_preview_svg`·`_design_intent`·`_colorways`·`_logo_slot_motif_id`.
- 디자인 세션·로고 api(`domains/design/router.py`) — **명시 목록, "등"으로 넓히지 말 것**:
  - 엔드포인트: `GET /design/sessions/{id}`, `POST /design/sessions/{id}/logo`(`place_design_logo`), `POST /design/motifs/photo-preview`.
  - run 해석: `_resolve_design_run`(:1198)·`_ResolvedDesignRun`(:496)·`_logged_design`(:930)·`_bounded_design_json`(:81).
    `_logged_design`은 지울 `list_design_turns` 근처에 있으니 블록째 지우지 말 것.
  - 로고 교체: `import_user_motif`(함수만 — `POST /design/motifs` 라우트는 store 사용처 0이라 지운다), `_activate_motif_slot`,
    `_dispatch_motif_activation`, `_finish_generation_success`(:1511이 `_resolve_design_run` 호출)·`_finish_generation_failure`,
    `_recover_stale_active_generation`, `_append_turn`, `_shielded`(:1114), `_short_design_description`(:1314).
  - 공용: `_ensure_motif_access`(턴 첨부 분기만 걷어냄), `_logo_slots`, `_intent_slot_motif_ids`, `_all_intent_motif_ids`,
    `_panel_logo_motif_id`, `_motif_preview_svg`, `_design_session_out`, `_pointer_svg_query`, `_user_motif_link_state`,
    `_user_motif_out`, `_resolve_staged_reference_image`, `_reference_image_payload`.
  - 턴 payload: `DesignAssistantGenerationPayload`, `DesignMotifActivateTurnPayload`, `DesignAssistantErrorPayload`,
    `DesignStepActivateTurnPayload`(`examples.py:252` 템플릿 시작·`router.py:1529` 로고 성공·`:2027` 파싱이 씀).
- store 디자인 기능: `features/design/`의 `attachments`, `context-tools`(`previewPhotoMotif`만), `errors`(`designErrorMessage`만),
  `queries`(세션 조회와 **active-generation 폴링** — 로고 렌더 중 새로고침하면 `active_generation_id`가 남아 있고
  이를 비우는 것은 `refetchInterval`뿐이다. 없으면 재시도 시 409 `generation_in_progress`, `router.py:2850`),
  `svg-preview`, `use-example-start`, `use-steps`(`usePlaceLogo`), `template-picker`, `template-shots`. `pages/design/*` 둘 다.
- admin 화면(이름만 바꿈): 렌더 로그(`seamless-list.tsx`·`seamless-detail.tsx`), 무늬·로고(`motifs/list.tsx`·`detail.tsx`),
  템플릿(`design-examples/list.tsx`). api `admin/generation.py`의 seamless 목록·상세·통계와 motif 목록·상세·수정.
  `pages/generation` 공용 파일은 `shared.tsx`·`generation-labels.ts`·`safe-svg-preview.tsx`. `job-status.ts`는
  **`shared.tsx:16,22`가 import한다** — 렌더 로그에 필요한 상태 라벨을 `shared.tsx`로 옮긴 뒤 지운다.
- worker:
  - `/generate` intent 경로(`_generate_from_intent`, `routes.py:365-417`)와 `_logged_generation`(:189),
    `/motifs/photo-preview`(+ `_normalize_preview_svg`·`_load_single_image`·`_fetch_reference_bytes`·`_reference_url_allowed`),
    `/motifs/import`(`normalize_motif_svg`만 씀 — 자동 태깅·임베딩 없음).
  - `engine/*`(resolver·categories·authoring을 import하지 않음 — 확인함), `render/raster.py`, `normalize.py`,
    `motifs/{registry,geometry,fingerprint,photo_svg}.py`, `motifs/store.py`의 `get_motifs`(intent 렌더 `routes.py:386,712`·
    tie-template `render.py:41`)·`approved_motif_ids`·`prune_stale_seeds`·import 부분,
    `design_plan/{schema,compiler}.py`(옛 `authoring/`, D5), `integrations.py`(ObjectStore·`content_key` — 어댑터 조립 아님).
  - **`render/segment.py`는 남기지 않는다** — 사용처가 `render/fabric.py:39`·`materials.py:5`뿐이다(원안의 "남김"은 틀림).
- 테이블: `design_sessions`, `design_session_turns`, `user_motifs`, `motifs`(`status` 포함), `design_examples`,
  `seamless_generation_logs`. `motifs`의 임베딩 컬럼만 지운다(+ 조건부 `description`·`tags`, Phase 4).
- GCS `uploads/`·`previews/`.

## 범위 밖

- 템플릿 엔진 정확도 개선, 새 템플릿 추가, `engine/patch.py`의 LLM patch 계약
  (`DesignPatchV1`·`apply_patch` 등) 정리 — 남는 경로는 `set_motif_slot`(:805-)만 쓴다. 따로 다룬다.
- 맞춤 주문 결제·견적 로직 변경. 참고 이미지 업로드 경로는 그대로 둔다.

## 실행 조건

- 바로 주문하기 변경(브랜치 `feat/et`)이 main에 머지·배포됐고, 운영에서 주문 → admin 참고 이미지 표시를 확인했다.
- 운영 Cloud SQL에서 읽기 전용으로 아래를 먼저 확인한다(접속 절차는 `infra/README.md`):
  - 진행 중인 생성: `active_generation_started_at > now() - interval '75 minutes'`인 `design_sessions` 행이 0건.
    (`active_generation_id is not null` 기준은 쓰지 않는다 — stale 회수는 사용자가 세션을 다시 건드릴 때만 돌아
    고아 행이 영원히 남을 수 있다. `STALE_GENERATION_JOB_AFTER`, `router.py:78`.)
  - 템플릿이 AI run을 가리키는지: `design_examples` ⨝ `seamless_generation_logs`(`run_id`)에서 `input_type`·`diagnostics->>'mode'`별 건수.
    `design_examples.run_id`는 ON DELETE RESTRICT(`db/src/db/models/design.py:115-116`)라 AI run을 가리키는 행이 있으면
    Phase 4의 로그 삭제가 실패한다. 있으면 그 템플릿을 먼저 내리거나 그 run을 삭제 대상에서 뺀다.

## 절차

각 Phase는 따로 PR로 낸다. 순서를 지킨다. 화면을 먼저 끊고, 그다음 api, 그다음 worker, 마지막에 스키마를 지운다.
**배포 결합:** main 푸시는 migrate(point of no return, `deploy.yml:65-74`) 뒤 Cloud Run을 배포한다. 그래서 인프라 일부는
Phase 5를 기다리지 않고 해당 Phase와 함께 움직인다(Phase 2.12, 3.7).

### Phase 1 — store·admin·packages/shared 화면 (api 변경 없음)

1. store 토큰 구매·내역·환불:
   - 지운다: `src/pages/token-purchase/*`(index·payment·success·fail), `features/token-purchase/`(디렉터리 전체),
     `src/pages/my-page/token-history.tsx`, `features/claims/ui/token-refund-section.tsx`.
   - `pages/order/detail.tsx:44`(import)·`:263-264`(`order_type === "token"` 분기)·`:291`을 정리한다 — 빠뜨리면 빌드가 깨진다.
   - 라우트 `src/app/router/index.tsx:73,153,160,167,213`. 옛 토큰 주소는 `/`로 redirect한다(`/color` 패턴 재사용).
   - 마이페이지·클레임의 토큰 진입점(`pages/my-page/index.tsx`·`claims.tsx`·`claim-detail.tsx`, `features/claims/model/config.ts`
     + `config.test.ts:54`).
   - `shared/lib/analytics.ts:37`의 `token_purchase` 타입(유일한 호출이 지우는 `success.tsx:52`).
2. store 잔여 AI UI:
   - `features/design/ui/finalized-gallery.tsx`(+test), `view-toggle.tsx`를 지운다(사용처 0).
   - `features/design/model/queries.ts`: `latestFinalizedJobQueryOptions`·`finalizedJobsInfiniteQueryOptions`·`FINALIZED_JOBS_PAGE_SIZE`,
     `GenerationJobOut`·`listGenerationJobs*` import, `queries.test.ts:9-46`을 지운다. **active-generation 폴링은 남긴다**(위 "남기는 것").
   - `features/design/api/context-tools.ts` `previewTextMotif`, `shared/lib/live-queries.ts:2,16-30` `tokenBalanceQueryOptions`.
   - `features/design/model/errors.ts:3-57`: `DESIGN_ERROR_MESSAGES`·`parseDesignError`·`isServerRejection`(토큰·authoring 문구,
     사용처는 테스트뿐)을 지우고 `designErrorMessage`만 남긴다. `errors.test.ts`를 맞춘다.
   - **`shared/store/session.ts`·`bootstrap-session.ts`·`auth-provider.tsx`는 건드리지 않는다** — 디자인 토큰 잔액 코드가 0건이고
     "token"은 로그인 액세스 토큰이다. 원안의 이 항목은 틀렸다.
3. store 주문 표시의 토큰 분기: `features/orders/model/display.ts:6`, `pages/my-page/orders.tsx:33,42`(+ 1의 `order/detail.tsx`).
   `use-checkout-payment.ts:218`·`use-payment-confirm.ts:2`는 주석만 고친다(분기 없음).
4. store 문구:
   - `pages/faq/model/faq-data.ts`: "AI 디자인" 카테고리(134-163)와 `:170` "배송지와 토큰 관리". `pages/faq/index.tsx:24` 설명.
   - `pages/notice/model/notice-data.ts:54,63,94`: 토큰 공지를 지우고, 2026-10-19 변경 고지를 새로 넣는다.
   - `features/home/hero.tsx:27-31`(tag "AI"·제목·문구), `features/home/lookbook.tsx:20,25,30,35`(alt)·`:47-48`(제목·문구).
     `public/images/home/ai-*.webp`는 hero가 계속 쓰므로 둔다.
   - `pages/refund-policy/index.tsx`: §11(112-117)과 19·140행 토큰 언급을 지운다. §12 → §11로 번호를 당기고 시행일 `:128`을 2026년 10월 19일로.
   - `pages/terms-of-service/index.tsx`: 정의 30행, 서비스 내용 `:59-60`, §10(101)을 지우고 19·164 설명문을 고친다.
     §11-15 번호를 당기고 시행일 `:152`를 2026년 10월 19일로.
   - `pages/privacy-policy/index.tsx`: 목적 27행, 수집 항목 `:40`("프롬프트, 생성 결과와 사용 토큰 내역"), 처리위탁·국외이전의
     OpenAI 83·98을 지운다. 시행일 157을 2026년 10월 19일로. 사업자 표기는 `영선산업`·`ESSE SION`을 유지한다.
   - (선택) `public/robots.txt:9` `Disallow: /token`, `shared/ui/info-row.tsx:3`·`shared/ui/AGENTS.md:78` "토큰 상세" 주석.
5. packages/shared:
   - `claim-badge.ts:15,42-45` `token_refund` 분기와 `claim-badge.test.ts:11-31`.
   - `components/action-button.tsx:19-21` `variant="ai"`(사용처 0), 그것만 쓰는 `theme.css:169-175`(`--color-bg-ai-*`)·`:345-354`
     (`.bg-ai-gradient`), 문서 `docs/foundation/gradient.md:8`·`design-token-reference.md:43-45`, 그리고 `packages/shared/AGENTS.md`·
     `apps/store/src/shared/ui/AGENTS.md`의 표 행(원안 Phase 6.7을 여기로 옮김).
6. admin 화면 — 삭제:
   - `pages/authoring/*` 전체, `pages/generation/jobs-list.tsx`·`job-detail.tsx`(+tests), `pages/design-examples/new.tsx`.
     `job-status.ts`는 상태 라벨을 `shared.tsx`로 옮긴 뒤 지운다. `shared.tsx`의 `UUID_PATTERN`·`formatDuration`(jobs 전용)도 지운다.
   - 라우트 `app/router/router.tsx:277-339,356-363`. 사이드바 "생성 작업"·"few-shot 후보"·"few-shot 시범"(`shared/config/navigation.ts:60-74`).
   - 템플릿 목록의 "등록" 버튼(`design-examples/list.tsx:209`)과 `list.test.tsx:98`의 `DesignExampleNewPage` import.
7. admin 화면 — 이름 바꾸기와 AI 부분 걷어내기(경로는 그대로):
   - `shared/config/navigation.ts:53-80`: 그룹 "생성·에셋" → "디자인", 세 항목 이름 변경. `widgets/admin-shell/admin-sidebar.test.tsx`.
   - 렌더 로그:
     - "Seamless" 문구 전부 — `seamless-list.tsx:285,348,352,355,375,383,384,403,408`, `seamless-detail.tsx:141,171,175,195,471`
       (+ RouteHeading·문서 title). 실행 시 `grep -n Seamless`로 다시 센다.
     - 프롬프트(`prompt`·`has_prompt`), 토큰 정산(`token_accounting`), LLM·RAG 진단(authoring 시도·선택 예시·
       motif_resolutions·plan/compiler/prompt revision)을 지운다. 입력 방식 필터를 지우고 표시만 남긴다.
     - `generation-labels.ts`에서 AI 경로만 내는 값을 지운다: `GENERATION_MODE_LABELS`의 `prompt`·`patch`, `PATCH_AXIS_LABELS` 전체,
       `INPUT_TYPE_LABELS.prompt`, `FAILURE_STAGE_LABELS`의 `authoring`·`motif_resolution`, `FAILURE_CODE_LABELS`의
       `authoring_invalid`·`scope_rejected`·`semantic_mismatch`·`provider_request_failed`. 남는 값은 `_generate_from_intent`가 내는
       모드 `variation`·`motif_slot`, 단계 `constraints`·`intent`·`design`, 코드 `constraint_conflict`·`intent_invalid`·`design_invalid`.
     - `seamless-list.test.tsx`·`seamless-detail.test.tsx`를 맞춘다.
   - 무늬·로고:
     - 제목 "모티프 상세"(`detail.tsx:228,231,372,376,416`) → "무늬·로고 상세".
     - "카탈로그 검토"(`MotifReviewActions`, `:245-`), 검토 상태 배지(`:404`), "검토 상태/검토 시각" 행(`:430-436`), 목록 `status` 필터를 지운다.
     - "검색 메타데이터" 카드의 `description`·`tags` 편집(`:83-175`)과 태그 표시(`:473-`)를 지운다. `subject`·`style` 편집은 남긴다.
     - 출처(`seed`·`user_upload`·`gpt_image`) 표시는 남긴다.
   - 템플릿: RouteHeading·문구 "디자인 예시" → "템플릿", "첫 진입 갤러리 예시" → "스토어 템플릿 목록", `list.tsx:207` "토큰 차감 없이"를 지운다. `list.test.tsx`.
8. admin 화면 — 그 밖의 정리:
   - `pages/pricing.tsx`(토큰 플랜), `pages/settings.tsx`(`design_*_cost`·`design_token_initial_grant`·OpenAI 렌더 단가).
   - `pages/customers/detail.tsx`(잔액·수동 지급), `pages/customers/list.tsx:66-69` "토큰" 열(+ `list.test.tsx:35`).
   - `pages/dashboard.tsx`(토큰·생성 지표, `:224` `token_amount`).
   - `pages/orders/*`·`pages/claims/*`·`shared/lib/format.ts`·`shared/ui/status-badge.tsx`의 토큰 주문·토큰 환불 분기.
9. 검증:
   - `pnpm lint && pnpm build && pnpm typecheck && pnpm test`, `pnpm architecture:check`.
   - Phase 2 재생성 전 사용처 0 확인: `git grep -nE "listGenerationJobs|getTokenBalance|previewTextMotif|TokenRefund|RefundableTokenOrders|ApproveTokenRefund|ManageTokens|AdminCustomerTokens|reviewAdminMotif|MotifResolutionOut|token_balance|token_amount|token_refund|tokenBalance" -- apps packages ':!packages/api-client'`가 0건.
   - browser-use로 store 헤더·홈·마이페이지·주문 상세·FAQ·공지·약관·환불정책·개인정보처리방침을 확인하고, admin 사이드바에 죽은 링크가 없는지,
     "디자인" 그룹에 렌더 로그·무늬·로고·템플릿 세 항목만 남았는지 본다. 템플릿 → 로고(SVG·사진) → 바로 주문하기를 한 번 돈다.

### Phase 2 — api 엔드포인트 + 명세 + api-client (돈 경로)

1. `domains/design/router.py`에서 지운다:
   - 엔드포인트: `text-preview`·`ideas`·`motifs`(GET list·DELETE·**POST 라우트**)·`POST /design/sessions`(빈 세션)·
     `GET /design/sessions`(목록 — store는 `use-example-start.ts`의 쿼리키 무효화만 하므로 그 한 줄과 함께)·
     `DELETE /design/sessions/{id}`(:899, 사용처 0)·`turns` GET/POST·`/design/generate`·`steps/activate`·`/design/export`·
     `finalize`·`/design/jobs*`·`order-reference`·`motifs/search`·`motifs/generate`·`motifs/activate`·`/color`.
   - 헬퍼: `_start_generation`(:1379 — 호출부 `_dispatch_generation`·`generate_motif`뿐이라 **지울 대상**, 원안은 남김으로 잘못 적음),
     `_undo_generation`(:1592), `_run_finalize`, `_order_reference_sources`, `_generation_job_out`, `_build_conversation_context`,
     `_dispatch_generation`, `_dispatch_motif_generation`, `_save_generated_motif`, `_motif_results`, `_motif_label`, 그리고 상수
     `MAX_DESIGN_IDEA_LENGTH`·`MOTIF_SEARCH_LIMIT`, 응답 `DesignGenerateOut`, 모듈 독스트링(:1-5)·import(:21-28,:51-52).
     **`_resolve_design_run`은 지우지 않는다**(위 "남기는 것").
   - 걷어낸다: `_finish_generation_failure`·`_recover_stale_active_generation`의 `ledger.refund_failed_generation`,
     `_ensure_motif_access`(:1932-1950)의 `DesignTurnAttachment` 분기(Phase 4 DROP 전에 반드시),
     `import_user_motif`(:789-797)의 `description=None`·`tags=[]` 쓰기(Phase 4에서 컬럼을 지울 때), 세션 응답의 `last_prompt`·`current_plan`(store 사용처 0).
2. `domains/design/examples.py`: `create_admin_design_example`(`:286-`)와 `AdminDesignExampleCreateRequest`만 지운다.
3. `domains/tokens/*`를 통째로 지운다(`/admin/tokens/manage`·`/admin/token-refunds/{id}/approve`도 `tokens/router.py:85,100`에 있어 함께 사라진다).
   `main.py`의 import(:330,:361)와 include(:371,:384)를 지운다. tokens를 import하는 나머지도 고친다:
   - `admin/customers.py`(목록·상세의 잔액, `GET /admin/customers/{id}/tokens`:341), `admin/payment_incidents.py:411-417,606-611`,
     `admin/generation.py:18`, `users/router.py:15-16,123-150,184`(탈퇴 이력 검사의 `DesignToken`·`TokenPurchase`·`GenerationJob`),
     `auth/service.py:10,167,268`(`grant_initial_tokens` — 가입·소셜 신규 가입), `apps/api/scripts/seed.py:22,41,114-124,500-501`(`_ensure_initial_tokens`).
4. 토큰 주문·클레임 분기:
   - `payments/service.py`: `_token_order_amount`:126, `_grant_purchased_tokens`:714, `_claw_back_purchased_tokens`:1167과 호출부
     538·651·1121, `_post_status`:96, `total_tokens`(:139-154, :449-460, :636-694), 웹훅 CANCELED `USER_LOCK`(:940-955).
   - `payments/schemas.py:19,26` `token_amount`(store `use-payment-confirm.test.tsx:81,105,110`·`payment-success.test.tsx:98`도 맞춘다).
   - `orders/router.py:109`, `orders/status_machine.py:40,48,64,110,132`, `orders/service.py:1140`(주석).
   - `claims/service.py:38,45,53,143-145`, `admin/claim_operations.py:135`, `admin/claims_schemas.py:14`.
   - `admin/schemas.py:15,19,112,116-119`(필터·대시보드 필드), `admin/orders.py:369,507-552`(대시보드 시계열).
5. admin api:
   - `domains/admin/authoring.py`를 지운다.
   - `domains/admin/generation.py` 부분 삭제:
     - generation_jobs 3종(:515-705)과 `finalize_duration_seconds`·`_job_*`·`_parameter_summary`·`_result_url`.
     - `_generation_outcome`(:960-1035)의 `GenerationJob`(finalized, :1020)·`generate_request` 턴 판정 — seamless 상세(:1149)가 쓰므로 함수는 남기고 갈래만 걷어낸다.
     - `_generation_token_accounting`(:1038)과 `token_accounting`, `prompt`·`has_prompt`, `_safe_diagnostics`의 authoring·resolution 부분, `_safe_patch`.
     - `POST /motifs/{id}/review`(:1302)·`MotifReviewRequest`, motif 응답의 `reviewed_at`(:285,:1181).
     - `MotifUpdateRequest`의 `description`·`tags`와 수정 시 `embedding_openai = None` 초기화.
   - `admin/configuration.py`: token_plan(:49-54), SettingKey·범위(:57-77)의 토큰·OpenAI 단가, `_price_out`·`PricingValueOut.unit`의 "개".
6. 배치: `domains/batch/router.py`의 `/authoring-promotion-candidates`·`/recover-token-works`(:8,17,102-109,153-).
   이미지 2단계 삭제 배치(`:113,147`의 finalize 단어)는 무관하니 남긴다.
7. 설정·연동:
   - `config_defaults.py`: `design_*` 단가·초기 지급(:27-31)과 토큰 플랜(:69-75)을 지운다. **`_RETIRED_ADMIN_SETTING_KEYS`(:35)는 지우지 말고**
     지운 `design_*` 키를 거기에 넣고, 토큰 플랜 키는 `_RETIRED_PRICING_KEYS`에 넣는다 — seed·seed-config 재실행이 행을 정리한다(:119-121).
   - `config.py`: worker finalize URL·audience, `design_ideas_rate_limit_*`(:42-43). `main.py:252-256` `design_ideas_rate_limiter`.
   - `integrations/worker.py`: `capability_mode`(:47-57)의 finalize 조건(빠뜨리면 AttributeError), `_finalize_client`,
     메서드 `finalize`·`motif_candidates`·`motif_generate`·`motif_text_preview`·`ideas`·`*authoring*`·`export`, `:167` `/finalize` 분기, FINALIZE_* 에러 매핑.
   - `integrations/gcs.py:98,241` `copy_from_bucket`(유일한 호출부가 order-reference)와 `tests/fakes.py:40`·`test_gcs.py`의 해당 부분.
8. 명세 갱신(같은 PR, 대원칙):
   - `docs/api-spec/money.md`: §6 삭제, 제목·§1(:10,:13 TKN·TKR)·§5(:80,:84)·§7(:124-125)·§8(:136,:145,:147)·§9(:152,:158)의 토큰 언급.
   - `docs/api-spec/domains.md`: §2(:29 초기 지급), §3(:37 탈퇴 이력), §4(:41-47), §10(:87,:99,:107), §11을 남는 표면
     (examples 공개 2종·세션 조회·logo·photo-preview·`/images/upload-url` kind `design_reference`·`/design-uploads/{id}/complete`)으로 줄인다.
   - `docs/api-spec/authoring-plan-v3.md`·`design-evaluation.md`를 삭제한다. 전자는 대부분 LLM 저작·few-shot·승격 운영이고,
     후자는 LLM 평가(지우는 `eval_design_accuracy.py`)다. 단 템플릿이 DesignPlan v3이므로(D5) `authoring-plan-v3.md` "저작 계약과 런타임 정본"의
     schema·compiler·`tests/golden/json` 회귀 픽스처 줄과 "Plan에는 normalized ratio…" 문단을 `docs/api-spec/worker-engine.md`로 옮긴다.
   - **같은 PR에서** 두 문서로 가는 링크를 고친다 — 안 고치면 이 PR의 `pnpm architecture:check`(문서 링크 gate)가 실패한다:
     `ARCHITECTURE.md`(§6.3 441-443, §8.3 546·550), `infra/README.md:281`, `docs/api-spec/worker-motifs.md`,
     `docs/reviews/design-engine-accuracy-2026-09-09.md:5`·`design-evaluation-foundation-2026-09-08.md:3,13,29`(리뷰는 링크만 평문으로).
     실행 시 `git grep -n "authoring-plan-v3\|design-evaluation.md"`로 다시 센다.
9. `pnpm codegen` 후 `packages/api-client` 생성물을 같은 커밋에 넣는다(CI codegen-drift).
10. 테스트(testcontainers 유지, mock 금지):
    - 삭제: `test_admin_authoring.py`·`test_tokens.py`·`test_token_adjustment_safety.py`.
    - 정리: `tests/authz.py`(인가 매트릭스 :54,:189,:201,:231-238,:279-281 — 안 지우면 test_authz가 404로 실패), `factories.py`,
      `test_admin_generation.py`, `test_design.py`, `test_design_examples.py`, `test_payments.py`, `test_admin_management.py`,
      `test_admin_orders.py`, `test_admin_phase_d.py`, `test_auth.py`, `test_batch.py`, `test_users_domain.py`, `test_gcs.py`.
11. 스케줄러: `infra/scheduler.tf`의 `authoring-promotion-candidates`·`recover-token-works`(:17-18)와 주석 "배치 5종"(:1)을
    이 PR에 넣고, **이 PR 배포 직후 사람이 `tofu -chdir=infra apply`**한다 — 늦으면 스케줄러가 5분마다 404를 받는다.
12. 검증:
    - `uv run pytest`로 위 10의 파일만 지정해 돈다. `uv run ruff check . && uv run pyright`, `pnpm codegen && git diff --exit-code packages/api-client`.
    - 로컬에서 템플릿 → 로고(SVG·사진) → 바로 주문하기 → 주문 제출을 끝까지 실행한다(Toss DryRun). 로고 렌더 중 새로고침 후 재시도도 본다.
    - 회원 탈퇴(`DELETE /users/me`)와 admin 대시보드·고객 목록·렌더 로그 상세가 200인지 본다.

### Phase 3 — worker

1. `api/routes.py`에서 지운다:
   - `/generate`의 `_generate_from_patch`·`_generate_from_prompt`(:420-) 분기와 그 LLM·RAG 진단,
     `/motifs/candidates`·`/ideas`·`/motifs/generate`·`/motifs/text-preview`·`/export`·`/finalize`(`finalize_router`),
     `/authoring/*` 5종(:871-1000 — `compile-preview`·`examples/prepare`·`examples/embedding-model`·`promotions/scan`·`promotions/embedding`).
   - 헬퍼: `_log_scope_rejection`(:841), `_record_adapter_failure`(:154), `_safe_motif_context_text`(:606).
   - `_logged_generation`의 `mode` 판정에서 `patch`·`prompt` 갈래, `motif_resolutions` 진단, `prompt=` 기록(:226, :806, :859)을 지우고
     `input_type`은 `"intent"`로 고정한다. `_safe_generation_error`(:143-146)의 `AdapterNotConfigured`·`AdapterClientError` 분기와
     `GENERATION_ERROR_MESSAGES`의 `authoring_invalid`·`semantic_mismatch`(:108-114)도 지운다.
2. `api/schemas.py`(:9-14 import — 안 고치면 worker가 import 단계에서 죽는다): `GenerateRequest`의 `prompt`·`motif_ids`·`conversation_context`,
   `ScopeRejectedResponse`, Authoring·Promotion·Ideas·Export·Finalize·Candidates·MotifGenerate·TextPreview 스키마.
   `main.py`의 `build_adapters`(:10,:29-32)·`finalize_router`·`service_mode` 분기(:37-42), `api/__init__.py:1`의 `finalize_router` export.
3. 모듈 삭제(각각 남는 경로가 import하지 않음을 확인함):
   - `adapters/` 전체(`__init__.py`의 `build_adapters`·`Adapters`·`log_provider_usage` 포함, `named_colors.py`는 `llm.py`만 씀).
   - `authoring/`에서 `schema.py`·`compiler.py`·`__init__.py`를 **뺀 나머지**(`examples`·`preview`·`promotion`·`retrieval`·`store` + `data/gallery-v1.json`).
     남은 셋은 `git mv`로 `worker/design_plan/`으로 옮기고(D5) import를 전부 바꾼다: `seed_design_examples.py`, `.claude/skills/tie-template/`
     (`scripts/render.py:37`, `SKILL.md:35-36`), 테스트, `biome.json:16`(`authoring/data` 제외 줄 — data를 지우면 줄째 삭제),
     `docs/api-spec/worker-engine.md`(Phase 2.8에서 옮긴 계약), `docs/plans/offbeat-logo-large-tile.md:36,64`.
     `__init__.py`·모듈 docstring의 "LLM·저작" 서술도 고친다. 삭제를 먼저 하고 이동은 같은 PR의 별도 커밋으로 둬서 diff가 섞이지 않게 한다.
   - `render/{photoreal,fabric,inlay,materials,motif_mask,weave,segment}.py`, `render/assets/fabric/`(+ `__init__.py`),
     `render/assets/photo/`의 `tie-base.png` 외 PNG(`tie-base-mask`·`tie-knot-mask`·`tie-mask`·`tie-shadow`)와 `photo/__init__.py`
     (photoreal 전용), `render/assets/__init__.py`(남는 import가 없으면).
   - `motifs/{embeddings,resolver,tagging,text_svg}.py`, `motifs/fonts/` 전체, `motifs/store.py`의 검색 부분(:207,240,262,326,343 쿼리).
   - `motifs/categories.py`: `seed_motifs.py:24,470`이 쓴다 — 시드를 고친 **뒤에** 지운다(아래 4).
   - `config.py`: `service_mode`의 `"finalize"`, `fabric_dpi`, `finalize_image_quality`, `max_dpi`, `openai_*`, `llm_model`,
     `embedding_model`, `motif_similarity_tau`, `motif_generate_per_request_limit`, `db_max_overflow` 주석의 "resolver 선커밋". `max_tile_mm`은 남긴다.
4. 스크립트:
   - 삭제: `{backfill_motif_tags,calibrate_photoreal,collect_design_accuracy,eval_authoring,eval_design_accuracy,index_motif_embeddings,
     seed_authoring_examples,export_weave_swatches}.py`, `{authoring_prompts,design_accuracy_cases,gallery_eval_prompts}.json`, `apps/store/public/images/weaves/`.
   - `seed_motifs.py`: OpenAI 호출은 원래 없다(원안 서술 틀림). 고칠 곳은 `categories` import(:24)와 tags 생성(:470),
     retag 블록(:515-534, `embedding_openai=None` 쓰기 포함), `index_motif_embeddings` 안내 출력(:547-548). `description`·`tags` 쓰기(:509-510)는 Phase 4 결정에 따른다.
   - `seed_design_examples.py`: `authoring.examples` import(:35)와 `load_example_set`·`missing` 검사(:1369-1376)를 지운다
     (22개 CURATED가 모두 `plan=`을 인라인으로 가짐). `_upsert`의 `"prompt": None`(:1323)은 Phase 4에서 컬럼과 함께 지운다.
   - `extract_tie_assets.py:22` docstring "PNG 셋은 worker assets/photo/에"를 고친다.
   - `.claude/skills/tie-template/SKILL.md` — 템플릿 제작은 이 스킬로 계속하므로 AI 단계를 빼고 경로를 맞춘다:
     - 파일 지도(:33-36): `motifs/categories.py` 행을 지우고, `authoring/` 경로는 `design_plan/`으로(`render.py:37`도 3의 이름 변경에서).
     - 병렬 브리프(:189)의 `KO_TAGS·카테고리 그룹`, 병합 규칙(:196) "카테고리 그룹"을 지운다(categories 삭제로 넣을 곳이 없다).
     - 검사(:203)의 `test_motif_tagging.py`를 지운다(파일 삭제됨).
     - 보고(:225)의 "유료 임베딩 `index_motif_embeddings.py`"를 지운다.
     - (덤) 스토어 확인(:220)의 `/design/sessions/<id>/color`를 `/customize`로(이미 낡음).
     - `render.py`가 쓰는 `seed._compose_run`·`motifs.store.get_motifs`·`normalize_motif_svg`, `check_emblems.py`가 쓰는
       `GET /design/examples`·`motifs.subject`는 모두 남는다(확인함).
5. 의존성: `apps/worker/pyproject.toml`의 `fonttools`(text_svg 전용)를 빼고 `uv lock`, description의 "generate/finalize 두 서비스"(:4)를 고친다.
   `libs/svg-safety`의 `text_safety.py`(`sanitize_facet_text`·`is_suspicious_facet_text`)가 사용처 0이 되면 지운다.
6. 테스트:
   - `test_authoring_v3.py`는 **지우지 않는다** — 컴파일러 회귀(golden json) 테스트다. `test_design_plan.py`로 이름을 바꾸고
     `authoring.examples` 부분(:11 `_validate_example_set`·`load_example_set`)만 지운다.
   - 삭제: `test_adapters`, `test_authoring_{eval,promotion,store,studio}`, `test_finalize_jobs`, `test_photoreal`, `test_fabric`,
     `test_design_accuracy`(지우는 스크립트를 importlib로 로드, :14), `test_motif_resolver`, `test_motif_tagging`, `test_health.py:50-62`(service_mode),
     `test_generation_logging.py:179`(prompt·provider 실패), 참조 없는 `tests/golden/candidates.json`·`candidates/*.svg`.
   - 정리: `test_api_generate.py` — prompt·patch·ideas·text-preview 케이스를 지우고 **intent(:132-296, :389-437)·import(:750,:771)·
     photo-preview(:821,:861)는 남긴다**. `test_api_motifs.py` — 로고 교체 `motif_slot`(:308,:350,:362)과 DB 카탈로그 `/generate`(:137),
     import(:47)를 **남긴다**(원안의 "import·photo-preview만"을 따르면 로고 교체 테스트가 사라진다). `test_motif_store.py` — 검색 부분만 지우고
     `approved_motif_ids`·`prune_stale_seeds`(:43,:258-346)는 남긴다. `test_motif_processing.py` — text_svg(:53-108) 삭제.
     `test_seed_design_examples.py:10`, `test_avoid_layer.py`(authoring compiler·`apply_patch` 혼용 — 엔진 필터 부분만 남길지 판단), `test_config`.
7. 배포: `.github/workflows/deploy.yml:79`의 `gcloud run deploy worker-finalize`를 **이 PR에서** 지운다. 남겨 두면 `service_mode`에서
   `"finalize"`가 빠진 새 이미지가 worker-finalize에서 기동 실패하고, 그 시점은 migrate 뒤(point of no return)라 프론트 배포까지 멈춘다.
   서비스 자체(tofu destroy)는 Phase 5에서 지운다 — 역순이면 deploy가 "서비스 없음"으로 실패한다.
8. 명세:
   - `docs/api-spec/worker-motifs.md`: 서문의 "OpenAI vector(1536)", §3의 GPT Image 부분(photo_svg와 공유하는 VTracer 설명은 남김),
     §4·§5·§6, §7 본문(text-preview·폰트), §7.2를 지운다. §7.1 import 문단의 `embedding=null`, §8 "승인된 공개 풀"(D6로 유지 — 서술 확인),
     §9 시드 카탈로그(categories·`embedding_openai`·`index_motif_embeddings`), §10 설정값(openai·llm·embedding·tau·generate_limit)을 고친다.
   - `docs/api-spec/worker-pipeline.md`: §2(finalize)·§3(weave), §4 API 표면의 `/finalize`·`/export`·LangGraph, §5 소유권 계약의
     worker-finalize 블록·지운 엔드포인트·patch·저작·named_colors·`prompt|patch`·과금 문단, §6 끝의 fabric·photoreal, 제목을 고친다.
   - `worker-engine.md`는 남긴다.
9. 검증: 남는 테스트 파일만 지정해 `uv run pytest`. `uv run ruff check . && uv run pyright`, `pnpm architecture:check`.
   로컬 worker를 재시작한 뒤(`--reload` 없이 떠 있으면 옛 코드로 돈다) `seed_motifs.py`·`seed_design_examples.py`를 재실행하고,
   템플릿 시작과 로고 교체 재렌더를 확인한다.

### Phase 4 — DB (Alembic 경유만, DDL 직접 실행 금지)

0. 선행 gate — 아래가 0건이 아니면 마이그레이션을 머지하지 않는다(남는 코드가 지울 테이블·컬럼을 읽으면 500):
   `git grep -nE "GenerationJob|DesignToken|TokenPurchase|TokenWork|DesignTurnAttachment|AuthoringExample|AuthoringPromotion|embedding_openai|reviewed_at|reviewed_by" -- apps db/src ':!db/migrations/versions'`
   (`prune_stale_seeds`(`motifs/store.py:366-`)가 `DesignTurnAttachment`·`DesignSession.current_plan`을 참조한다 — 이 마이그레이션 PR에서 함께 고친다.)
1. 데이터 확인(로컬·운영 읽기 전용): `select key from pricing_constants where category='token'`, 실행 조건의 템플릿⨝run 쿼리.
   (2026-10-18 로컬: token 주문 0, claims 0, admin_settings design·token 키 5, token pricing 6행, `design_turn_attachments` 0행.)
2. 백업: **Phase 4 PR 머지 전에** 사람이 Cloud SQL 온디맨드 백업(`gcloud sql backups create`)을 만든다. main 푸시가 migrate를 자동 실행하고
   (`deploy.yml:71-74`), `pg_dump -t`로 표를 고르면 지우는 settings·motifs 컬럼·로그 행이 빠진다.
3. 새 마이그레이션 `db/migrations/versions/<date>_drop_ai_design.py`:
   - 토큰 주문·클레임은 0건이라 지우지 않는다. 토큰 테이블을 먼저 DROP하고(`design_tokens.source_order_id → orders`가 풀린다) 그다음 CHECK를 줄인다.
     혹시 token 행이 있으면 CHECK 추가가 실패해 마이그레이션이 멈추므로 조용히 데이터가 지워지는 일은 없다.
   - 데이터:
     1. `admin_settings`의 `design_*_cost`·`design_token_initial_grant`·`design_token_cost_openai_render_standard`, 토큰 플랜 `pricing_constants`.
     2. `seamless_generation_logs`의 `input_type='prompt'` 행과 `diagnostics->>'mode'='patch'` 행 — 단 `design_examples.run_id`가 가리키는 행은 제외.
   - CHECK 축소: `orders.order_type`(`commerce.py:209`), `order_items.item_type`(:265), `claims.type`의 `token_refund`(:345-347),
     `pricing_constants.category`(:603-606), `seamless_generation_logs.input_type`을 `('intent')`로. `design_sessions.status`의 `'finalized'`(`design.py:44`)는
     행이 0건이면 뺀다.
   - DROP: `generation_jobs`·`token_works`·`design_tokens`·`token_purchases`·`authoring_examples`·`authoring_promotion_candidates`·`design_turn_attachments`.
     (`design_sessions.active_generation_id`는 FK가 아닌 맨 uuid라 막히지 않는다, `design.py:35`.)
   - 컬럼: `seamless_generation_logs.prompt`(+ `seed_design_examples.py:1323` 쓰기 제거), `motifs.embedding_openai`와 `ix_motifs_embedding_openai_hnsw`,
     `motifs.reviewed_at`·`reviewed_by`. `motifs.status`와 CHECK는 **남긴다**(D6). `description`·`tags`는 남는 읽기 사용처가 없으면
     (`router.py:2455` `_motif_label`은 Phase 2에서 지워짐) 지우고 `seed_motifs.py:509-510`·`import_user_motif` 쓰기도 함께 지운다.
   - `vector` 확장은 DROP EXTENSION할 수 있다(down에서 되살린다). **`db/pyproject.toml`의 `pgvector` 패키지와 Docker 이미지
     `pgvector/pgvector:pg17`(`docker-compose.yml:4`, `ci.yml:105`, `db/src/db/testing.py:16`)는 남긴다** — 베이스라인 리비전
     (`20260803_f8c3b2a19d47_baseline.py:13,25`)·`20260803_6dbb8bb66939_openai_embedding.py:16`·`migrations/env.py:5,29`가 import하고,
     빈 DB에서 `upgrade head`(CI·testcontainers)가 그 경로를 지난다.
   - downgrade는 스키마(테이블·컬럼·CHECK·확장)만 되살린다. 데이터는 돌아오지 않는다고 마이그레이션 docstring에 적는다.
4. 모델: `db/src/db/models/seamless.py`(motif 임베딩·검토 컬럼, authoring 2개 모델, 렌더 로그 `prompt`), `design.py`(`GenerationJob`,
   `DesignTurnAttachment`, CHECK), `commerce.py`(CHECK), `tokens.py`(파일 삭제) + `models/__init__.py:3,6`의 import·export와 docstring의 테이블 수.
5. `db/README.md:28`의 임베딩·토큰 원장 설명을 지운다(`:8`·`:44` pgvector 컨테이너는 유지).
6. 검증:
   - 로컬 `upgrade head` → `downgrade -1` → `upgrade head` 왕복.
   - `\d motifs`(임베딩·검토 시각 컬럼 없음, `status` 있음), 위 1의 쿼리에 token 행 없음, `select key from admin_settings`.
   - 시드 재실행(`seed.py`·`seed_motifs.py`·`seed_design_examples.py`) 성공, 로고 교체 재렌더 e2e.

### Phase 5 — GCS·인프라·시크릿 (사람이 apply)

1. GCS: assets 버킷의 `fabric/`·`tile/` 접두 객체를 지운다. 먼저 목록·개수를 확인한다. 버킷은 `soft_delete retention=0`(`infra/main.tf:57-59`)이라
   **즉시 영구 삭제**된다. `uploads/`·`previews/`는 건드리지 않는다. 로컬 버킷은 `dev-assets`(fake-gcs-server).
2. `infra/cloudrun.tf`: `worker_finalize` 서비스(291-), invoker IAM(393-), depends_on(:374-375), api env `WORKER_FINALIZE_*`(16-17),
   `worker_finalize_plain_env`(58), 동시 커넥션 예산 주석(10). `worker_secret_env`(60-66)는 **두 worker 공통**이라 OpenAI 키 항목만 뺀다.
3. 시크릿 목록의 실체는 `infra/variables.tf:85`(`app_secret_ids`)다 — 여기서 `openai-api-key`를 뺀다(`secrets.tf`는 for_each뿐).
4. `infra/iam.tf`: `worker_generate_secrets`(:68-77)의 `"openai-api-key"`(빠뜨리면 시크릿 삭제 때 IAM 리소스가 깨진다), worker_finalize SA와
   흩어진 바인딩(:11-14, :39 cloudsql, :51 database_url, :80-90, :97 assets objectCreator, :140 deployer, :168 actAs).
5. `infra/outputs.tf:9-11` `worker_finalize_url`. `infra/README.md:65,178-179,248,256,281`. (`monitoring.tf`에는 해당 알림이 없다 — 할 일 없음.)
6. `.env.example`의 `OPENAI_API_KEY`(실행 시 grep으로 줄 확인).
7. OpenAI 대시보드에서 키를 폐기한다(사람).
8. 검증: `tofu -chdir=infra plan`의 diff가 위 항목뿐인지 본다. apply 뒤 api `/readyz`, 템플릿 → 로고 → 주문을 확인한다.

### Phase 6 — 문서·README·하네스

1. `README.md`: 9, 15-20, 44, 49, 63-64, 74, 78, 94-117, 129-130(스택 표), 143-146, 201의 OpenAI·토큰·채팅 생성 서술을 템플릿 → 색·로고 → 주문 흐름으로 다시 쓴다.
2. `ARCHITECTURE.md`: §0(15,37,44-46), §1.1(worker-finalize), §1.2, §1.3(132-133,138), §2.1(152,156), §2.2, §2.3(185), §3.2(223), §3.3(234 "Tokens"),
   §3.4(토큰 주문), §4.2(291), §5.1(329), §5.2, §5.3(348,357 `fabric/`), §5.4(365), §6.1(AI 쪽), §6.2(429), §6.3(441-443), §7·§7.3(491,494),
   §8.1(521,527 finalize ADR), §8.3(546,550). 실행 시 `grep -n` 으로 다시 짚는다.
3. `AGENTS.md`: 명령어의 `backfill_motif_tags`·`index_motif_embeddings`·`seed_authoring_examples`와 "`OPENAI_API_KEY` 필요" 문구, `:115` "GCS와 finalize는",
   도메인 규칙의 "토큰 과금". 시드 순서는 `seed.py → seed_motifs.py → seed_design_examples.py`. "Postgres 17+pgvector"(:27)는 이미지가 남으므로 둔다.
   `apps/admin/AGENTS.md:46` "customer token 조정 | token ledger" 행.
4. `docs/analytics.md:35,66-67`: `token_purchase` 이벤트를 폐기 표기(코드는 Phase 1에서 지움).
5. `docs/plans/token-pricing-recalibration.md`·`design-accuracy-followups.md`를 삭제하고, `docs/plans/AGENTS.md:15`의 예시(`token-pricing-recalibration.md`)를
   남는 플랜으로 바꾼다. `offbeat-logo-large-tile.md`는 엔진 플랜이라 남긴다(확인함).
6. `docs/assets/portfolio-hero.prompt.md:5`(finalize 개념)를 고친다.
7. `docs/reviews/`의 AI 기록은 역사라서 남긴다. 이 Phase에서 지우는 플랜으로 가는 링크만 고친다(예: `design-accuracy-baseline-2026-09-09.md:292`
   — `pnpm architecture:check`가 잡는다). 명세 문서 링크는 Phase 2.8에서 이미 고쳤다.
8. 에이전트 메모리(`~/.claude/projects/-Users-gimbongseob-git-essesion/memory/`):
   - 지움: `gemini-fewshot-wave-path-gap.md`, `worker-embedding-client-poisoned-until-restart.md`, `seed-motifs-lexical-only-grounding.md`,
     `openai-migration-local-state.md`, `production-sends-tile-and-photoreal.md`.
   - 고침: `config-key-needs-data-migration.md:13-14`(예시 키), `design-template-first-progress.md:14`, `turn-warnings-are-english-diagnostics.md`,
     `stale-worker-no-reload.md:22`(지운 메모 링크), `MEMORY.md` 인덱스.
9. 실행 결과를 `docs/reviews/ai-design-removal-<date>.md`에 기록하고 이 플랜을 지운다.
10. 검증: `pnpm architecture:check`(문서 링크 gate), `pnpm lint`.

## 검증 (전체)

- 운영: 템플릿 → 색 변경 → 로고(SVG·사진) → 바로 주문하기 → 결제 → admin 주문 상세에 참고 이미지가 보인다.
- 0건이어야 하는 것:
  `git grep -nE "token_work|design_token|TokenPurchase|token_refund|token_balance|embedding_openai|worker_finalize|WORKER_FINALIZE|worker-finalize|authoring_(examples|promotion)|generation_jobs|GenerationJob|DesignTurnAttachment" -- apps packages db infra .github ':!db/migrations/versions'`
- 눈으로 확인할 것(남는 줄이 정당한지):
  - `git grep -nIi openai -- . ':!docs/reviews' ':!db/migrations/versions'` — 법적 고지의 변경 이력 문구만 남아야 한다.
    (마이그레이션 이력·`docs/assets/portfolio-hero.png` 바이너리는 제외됐다.)
  - `git grep -n finaliz -- apps packages db infra ':!db/migrations/versions'` — 이미지 2단계 삭제 배치(`batch/router.py:113,147`)·`images.py:3` 정도만.
- `git grep -n "worker\.authoring\|worker/authoring" -- . ':!docs/reviews'`가 0건(D5 이름 변경 완료).

## 되돌리는 법 / 상향 신호

- Phase 2–4는 돈 경로·스키마 변경이다. PR 단위로 revert하고, 마이그레이션은 `downgrade -1`로 되돌린다.
  DROP한 데이터는 down으로 복구되지 않는다 — Phase 4.2의 Cloud SQL 백업에서 복원한다. GCS 삭제(Phase 5.1)는 되돌릴 수 없다.
- Phase 3을 revert할 때는 deploy.yml의 worker-finalize 단계도 함께 돌아오므로, Phase 5(tofu destroy) 이후에는 그 단계를 빼고 revert한다.
- 되돌릴 신호: 배포 뒤 결제 확정·클레임 5xx, 과거 주문 목록·상세 렌더 실패, 템플릿 세션 생성·로고 교체 재렌더 실패, 회원 탈퇴 5xx,
  deploy.yml 실패(특히 migrate 뒤 Cloud Run 단계).

## 매 Phase 끝 e2e (로컬, 이 셋이 남는 기능의 전부다)

1. **템플릿 제작:** tie-template 스킬 4단계 검사·시드(`seed_motifs.py` → `seed_design_examples.py` → `check_emblems.py`)가 warnings `[]`로 끝나고,
   `render.py`로 후보 하나를 렌더해 `_2x2.png`가 나온다.
2. **주문:** `/design`에서 그 템플릿 → `/customize`에서 색 변경·로고(SVG·사진) → 바로 주문하기 → `/custom-order` 제출(Toss DryRun).
   참고 이미지는 `custom_order` kind로 올라가 `ORDER_REFERENCE_IMAGE_TYPES`(`images/service.py:27`)로 묶인다 — 이 경로는 플랜이 건드리지 않는다.
3. **admin 기록:** 주문 상세에 참고 이미지(`design.png`·`design-panel.png`)가 보이고(`admin/pages/orders/detail.tsx`),
   "디자인 렌더 로그"에 로고 교체 run(`intent`·mode `motif_slot`)이 남는다.

## 실패 모드

"AI 전용"이라는 이름·위치로 판단해 지우는 것이 이 플랜의 실패 모드다. 2026-10-18 검토에서 실제로 나온 예:
`_resolve_design_run`(템플릿 시작·로고 교체), `authoring/schema·compiler`(템플릿 시드), `approved_motif_ids`(registry_version),
`job-status.ts`(렌더 로그 라벨), `categories.py`(모티프 시드), `design_turn_attachments`(로고 접근 검사). 반대로 `segment.py`·`_start_generation`은
"남김"으로 잘못 분류돼 있었다. 각 삭제 전에 **호출부를 grep**하고, Phase 2·3·4 끝마다 템플릿 시작·로고 교체 e2e를 실제로 돌린다.

## 기각한 대안

- **기능 플래그로 숨기기만:** 키·서비스·법적 고지가 남아 비용과 고지 불일치가 계속된다. AI 재도입 계획이 생기면 재론한다.
- **admin 경로·api 경로도 새 이름으로 바꾸기:** 이름만 바뀌는데 라우트·api-client 이름·테스트가 대량으로 흔들린다.
  이름과 경로가 어긋나 혼란이 생기면 재론한다.
- **토큰 환불 경로를 잔액 0까지 유지:** 유료 결제자가 0명이라 지킬 대상이 없다(D1). 유료 결제가 발견되면 재론한다.
- **schema·compiler를 `engine/`에 합치기:** 엔진은 intent를 렌더하는 층이고 Plan → intent 컴파일은 그 위층이다. 합치면 경계가 흐려진다.
  `authoring` 이름을 그대로 두는 안도 기각 — LLM 저작이 사라진 뒤 이름이 역할과 어긋난다(D5).
- **`motifs.status` DROP + 지문 풀을 `source='seed'`로:** registry_version 계산이 바뀌어 기존 렌더 로그와 값이 어긋난다(추정 — 풀 구성이
  같으면 값도 같을 수 있다). 검토 기능이 사라지면 `status`는 쓰는 값이 고정돼 남겨도 비용이 없다. 컬럼이 혼란을 주면 재론한다.
- **pgvector 패키지·이미지 제거:** 마이그레이션 이력이 import해 빈 DB `upgrade head`가 깨진다. 베이스라인을 squash할 때 재론한다.
