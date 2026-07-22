# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md) (§8 마이그레이션 순서). 단계 순서대로 진행하되, **0단계(사전 준비)는 리드타임이 있으므로 지금 바로 착수**.

## 0. 사전 준비 (리드타임 — 즉시 착수)

- [x] Apple Developer 계정 + Sign in with Apple 키·도메인 검증 신청
- [x] Naver 개발자 앱 등록
- [x] Google·Kakao 콘솔 확인, 새 redirect URI 등록 준비(도메인 확정 후 등록)
- [x] Toss 시크릿 키 확인 + 웹훅/콜백 URL 이전 계획
- [x] Solapi API 키 확보
- [x] 기존 생성 로그에서 finalize 실제 dpi 실측 → 워커 메모리 산정 근거
- [x] Supabase Auth 트랜잭션 이메일(가입 확인 등) 존재 여부 확인 → 필요 시 Resend
- [x] 기존 env 전체 수집 (YeongSeon + seamless-tile)

## 1. 골격

- [x] 모노레포 스캐폴드: pnpm workspace(+catalogs) + Turborepo, uv workspace(apps/api·worker), mise 툴체인 핀
- [x] 디렉토리 뼈대: `apps/{store,admin,api,worker}`, `packages/{api-client,shared,tsconfig}`, `db/`, `infra/`
- [x] 포트폴리오 문서: 루트 README + GPT Image hero + 현재 구현 기준 `ARCHITECTURE.md` — *구현 완료/스테이징 미개통을 분리하고 기존 계획 문구를 as-built 구성으로 교정*
- [x] 로컬: docker compose(Postgres + pgvector)
- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF — *IaC 작성 완료(+ migrate Cloud Run job, Cloud Scheduler 배치 4종, scheduler SA — 점검 F2·F3 반영. deploy.yml에 마이그레이션 스텝 포함). **4단계(워커 배포) 착수 시 수행**: `infra/README.md` 부트스트랩 후 `tofu apply` — Cloud Tasks·OIDC는 로컬 에뮬레이터가 없어 그전까지는 전부 로컬(compose + `.env`)로 개발*
- [ ] Cloudflare: 서브도메인(app/admin/api) + api 프록시(WAF·레이트리밋), wrangler 배포 설정 — *프록시 워커와 비로컬 API 전역 exact-secret 경계(`/healthz`·OIDC `/batch/*`만 면제, `/readyz`는 공개 프록시로만 확인), 고정 route·workflow 주입/validation·`PUBLIC_API_ORIGIN` OAuth callback은 구현 완료. **첫 API 배포 전에** `api.essesion.shop` secret·WAF를 선개통하고, 인증 사용자별 6회/60초 process-local 보조선만 있는 `/design/ideas`에 IP 기반 edge rate limit을 추가한다. 5단계에는 app/admin route만 잇는다 (`infra/cloudflare/README.md`, `docs/OPERATOR-CHECKLIST.md` §A4·C).*
- [x] CI(GitHub Actions): 빌드·린트(Biome / ruff+pyright)·테스트·배포, PR 검증 — *PR 코드는 외부 credential·런타임 SA 없이 build/test만 수행한다. main 배포는 동일 SHA의 push CI 성공 `workflow_run`으로만 실행하고 환경 단일 큐에서 진행 중 배포를 취소하지 않는다. 프론트 production env 누락과 localhost/example API 혼입도 차단한다.*
- [x] `ci/py` 포맷·로컬 설정 격리 회귀 수정 — *PR #18의 Ruff 포맷 드리프트를 정리하고, 표준 로컬 `.env`의 GCS 에뮬레이터 설정이 비에뮬레이터 URL 테스트에 유입되지 않도록 조건을 명시했다. 2026-07-20 후속 점검에서 worker 포맷 드리프트 4건과 Python dependency deprecation(Authlib JOSE→joserfc, Starlette TestClient→dev-only httpx2)을 정리했으며 Ruff check/format·Pyright·pytest 792건, 경고 0건 통과.*
- [x] 2026-07 전체 리팩터링 감사 — *API/DB·worker·store/admin/shared·CI/IaC의 경합, 입력 상한, 신뢰 경계와 공급망을 교차 검토하고 고위험 항목을 회귀 테스트와 함께 반영했다. 결과와 이연 근거는 `docs/reviews/repo-refactor-2026-07.md`.*
- [x] 2026-07 인라인 리뷰 후속 — *finalize 한도 검증 단일화·쿼터 인덱스(status 포함/CONCURRENTLY), fake-gcs `/data` 영속화, 배치 assets 버킷 분기 단순화, 디자인 충전 비활성화·중복 첨부 제거·완성본 더 보기·삭제 캐시 테스트를 반영하고 관련 API·마이그레이션·store 검증 완료.*
- [x] GitHub secret scanning + push protection 켜기, osv-scanner CI 스텝
- [x] Renovate 설정(묶음 PR) — *레포에 Renovate GitHub App 설치 필요*
- [x] Aside 브라우저 확인 하네스 — *프로젝트 MCP(`.mcp.json`) + `.claude/skills/aside-browser/SKILL.md`, CLI 로그인·MCP 등록 확인*
- [ ] GCP 예산 알림 1개 + uptime check 1개 — *tofu에 포함, **4단계 apply 시 함께 생성***
- [ ] Sentry 프로젝트(api·worker·store) 연결, JSON 구조화 로깅 + request_id 전파 골격 — *서버 골격(`libs/obs`)과 store 선택적 초기화·민감정보 제거·request_id 태깅 완료, DSN이 없으면 no-op. **4단계 전체 apply 전** 프로젝트 3개를 만들고 api/worker DSN은 Secret Manager, store DSN은 GitHub build-time 변수로 주입*
- [ ] Secret Manager에 기존 env 배치 — *시크릿 컨테이너는 tofu 소유. **4단계 target apply 후·전체 apply 전** provider 값을 주입하고 jwt/session/edge secret은 환경별로 새로 생성 — 그전까지 로컬 `.env`*

## 2. 스키마 재설계

- [x] 기존 스키마 전수 검토(YeongSeon `supabase/schemas`) — *enum·뷰 19종·DB함수 ~40종·트리거 17종·부분 인덱스까지 대조*
- [x] 새 스키마 설계 — 도메인·데이터 의미 보존, generate-tile 잔재(ai_generation_logs 등)·LangGraph checkpoint·미사용 뷰 제외, DB함수 로직은 api로 — *35테이블, `db/src/db/models/`*
- [x] **기존→새 스키마 매핑 표 작성** — `db/MAPPING.md` (테이블·함수/트리거 소유 이동·이관 정책)
- [x] Alembic 첫 리비전 생성·로컬 적용 — *베이스라인 리비전 생성, 로컬 upgrade와 `alembic check` 드리프트 0*
- [x] 후기·공개 문의 스키마 확장 — *`reviews` 신규 테이블과 문의 `is_secret`·`샘플제작`·공개 목록 인덱스를 Alembic 리비전 2개로 적용, `alembic check` 드리프트 0 (`docs/plans/store-reviews.md`)*
- [ ] Alembic 스테이징 적용 — *4단계 첫 배포의 migrate Cloud Run job 성공과 단일 head를 확인한 뒤 체크*
- [x] 데이터 변환 스크립트 초안(상품·단가·모티프 등 — 유저·이미지 제외) — *`db/scripts/migrate_data.py`, 유저 종속은 3단계 유저 매칭 확정 후 스텁 해제*

## 3. api 1차

- [x] Auth 골격: JWT(access 단명 + refresh 회전), argon2id — *refresh는 불투명 토큰 sha256 저장, 재사용 감지 시 전체 무효화*
- [x] id/pw 로그인 — 공개 가입 없음, 계정은 시드/관리자 생성만 — *`apps/api/scripts/seed.py`*
- [x] 소셜 OAuth(Authlib): Google·Kakao — *provider 검증 이메일만 연결, 공개 Cloudflare callback origin 고정*
- [x] 로컬 OAuth 세션 쿠키 충돌 방지 — *store refresh 쿠키를 `essesion_store_refresh`로 네임스페이스하고, 다른 localhost 앱의 오래된 `refresh_token`이 공존해도 정상 회전되는 PostgreSQL 회귀 테스트·Aside 새로고침 복원을 확인*
- [x] 소셜 OAuth(Authlib + joserfc): Apple·Naver — *Naver는 @naver.com 주소만 검증 취급, Apple은 .p8 ES256 client_secret JWT(joserfc 허용 알고리즘 고정 + 임시 P-256 키 서명 회귀) + form_post POST 콜백(세션 쿠키 SameSite=None). Apple Services ID·실키·env가 없어 provider 수락 운영 E2E는 미완(Services ID 발급 대기)*
- [x] 휴대폰 인증(Solapi) — *재전송 60초/일 5회/만료 5분, 시크릿 없으면 DryRun*
- [x] 인가 3규칙 구현(공개 조회 = 상품·찜 / 나머지 owner-only / 관리자 별도 역할) + **testcontainers 403 테스트** — *테이블 주도 매트릭스(tests/authz.py), 도메인 추가 시 행 추가*
- [x] 도메인 모듈 — 돈 경로 우선: 주문 3종(일반/맞춤/샘플) → Toss 결제 → 토큰 과금 → 클레임/배송지/문의/견적/쿠폰/장바구니/찜/마이페이지 — *승인은 successUrl 콜백 confirm + ALREADY_PROCESSED 조회 복구 + `/payments/webhook` 조회 재검증 대사(money.md §9). DONE 재수신도 provider/stored key·총액을 재검증하고, CANCELED는 USER advisory→order row 순서로 토큰 사용과 직렬화해 reserved 쿠폰만 복원한다. 웹훅은 스테이징 프록시 개통 후 처음부터 `api.essesion.shop`만 등록한다.*
- [x] 후기·공개 Q&A API — *완료 주문 기반 후기 CRUD·공개 평균/목록·관리자 목록/삭제, 주문 `write_review` 액션·review_id 읽기모델, 공개 문의 목록과 서버 비밀글 마스킹·샘플제작 카테고리를 구현하고 api-client 재생성. 실제 PostgreSQL 인가/도메인 테스트 포함 (`docs/plans/store-reviews.md`)*
- [x] GCS 서명 업로드 URL 발급(ImageKit 대체) + 회원 탈퇴 + 정리 배치(Cloud Scheduler → api) — *배치 4종 `/batch/*`, 4단계에서 Scheduler OIDC 연결*
- [x] OpenAPI 스펙 확정 → api-client 코드젠(Hey API + TanStack Query + zod) → **CI 드리프트 검사** — *`pnpm codegen`, ci.yml codegen-drift 잡*
- [x] schemathesis CI 스텝 — *pytest 통합(tests/test_contract.py) — CI py 잡에 포함*

## 4. worker

- [x] 엔진 재구현: compose/candidates/placement + 모티프 검색(pgvector) — *compose/placement(4종)/seamless/validate/candidates + pgvector motif store/resolver(exact→Vertex AI embedding τ=0.84→Recraft 생성) + ADC 기반 Google SDK 어댑터(Gemini·embedding)·Recraft + prompt→intent 경로 완료. 골든 25 intent byte-identical 유지*
- [x] resvg 인프로세스 래스터화 동등성 검증 → 실패 시 librsvg 서브프로세스 폴백 — *판정 (b) 조건부: resvg-py 0.3.3 vs rsvg-convert 2.62.3, 골든 27종 치수 완전 일치·형상/색/채움 동일, 차이는 도형 경계 AA에 100% 국한(색경계 ≤1.5px, 침식 2회 소멸). byte-identical 미달이라 즉시 채택 불가. librsvg 기준선 유지·코드 무변경. 전환 시 fabric 골든 재베이스라인 전제. 상세: `docs/reviews/resvg-parity.md`*
- [x] finalize 파이프라인 재설계(중간 산출물 재사용 — 4~5회 재실행 승계 금지) + export — *yarn_dyed·material_map·relief 재설계 완료: 별칭 슬롯 라벨 세그먼트 1회로 마스크 파생, 렌더 호출 최악 5회→3회(테스트가 카운트 assert). weave 에셋 7종, FinalizeRequest 4필드(weave/material_map/texture_strength/relief_strength)*
- [x] **결정론 계약 대조 테스트**: 같은 intent+seed → byte-identical SVG (기존 seamless-tile 테스트 50+개 기준) — *원본 엔진 재실행으로 추출한 intent 골든 25종을 byte-identical 통과하고 대표 seed·candidate 변형을 별도 검증. 대표 compose는 PYTHONHASHSEED 0/1/12345에서 교차 검증. 원본 테스트 계층 이식 완료(래스터 seam 가드·motif_id parity·geometry·엔진 엣지)*
- [x] 리팩토링(원본 대조 점검 후속): config 검증·defusedxml·resolver 가드·어댑터 수명·stripe 정규화·/export 배선·프리뷰 병렬화·render/weave 분리 — *스펙 `docs/specs/worker-refactor.md` R1~R15 완료. 당시 별도 5단계 트랙으로 분리한 text·사진 모티프의 현재 상태도 같은 스펙 하단에 갱신, 실행 기록 `docs/plans/worker-refactor.md`*
- [x] 전체 감사 후 worker 실행 경계 하드닝 — *finalize 960초 processing lease+attempt 조건부 terminal update(실 Postgres 통합 테스트), invalid input만 terminal 처리하고 그 밖의 예외는 temporary marker+500으로 다음 delivery에서 재실행, 공개 오류 코드로 raw 예외 노출 차단, motif read savepoint로 앞선 미커밋 upsert 보존, generate/finalize `SERVICE_MODE` 라우터·OIDC audience 분리, Cloud Tasks audience·910초 dispatch deadline 정합화, path/lattice/scatter/stripe 반복량 사전 상한, Poisson 공간 격자, 래스터 20M pixel·120초 timeout, preview/Cloud Run 동시성 제한, Recraft strict base64/바이트 상한(URL 2차 요청 제거).*
- [x] Gemini 저작 실패율 개선 — *모델의 전체 intent 직접 저작을 structured `DesignPlan`(모티프·색·배치·밀도·크기·방향·stripe)으로 축소하고 코드가 엔진 intent를 결정적으로 컴파일한다. exact/private ID 비노출, resolved 다중색 slot 자동 결합, 1회 constrained retry와 30 prompt 유료 opt-in A/B 평가 하네스를 추가했다.*
- [x] Gemini Plan v3 + active RAG few-shot·승격 파이프라인 — *25개 golden bootstrap, strict typed `DesignPlansV3`/Vertex `response_schema`, 결정적 compiler와 구조 다양성 retry를 구현했다. 매일 05:00 KST에 성공·선택·finalize된 생성 Plan을 최대 100건 선별하고 structural fingerprint 및 동일 family·motif count의 cosine 0.95로 active 예시와 pending/hold 후보 중복을 제거한다. 관리자/manager는 후보와 근거를 추적하고 admin은 Hold·Reject·Approve 및 승인 예시 활성화를 관리한다. Approve는 현재 embedding을 확인한 뒤 즉시 active RAG에 반영되고 `active=false`는 즉시 제외된다. RAG는 revision 없이 현재 active 승인 예시만 family 다양성 기준 최대 3개 사용하며 장애 시 few-shot 없이 계속한다. rollout mode와 비율은 env가 아닌 DB 관리자 설정에서 읽고 잘못된 값은 legacy로 닫힌다. API-client, 관리자 화면, 배치/IaC, 파괴적 개발 마이그레이션, 평가·sync 도구와 실제 PostgreSQL 회귀 테스트를 함께 갱신했다 (`docs/specs/authoring-plan-v3.md`).*
- [x] 생성 실패 진단·오류 계약 — *reference/constraints/authoring/intent/candidate 단계별 고정 422 code와 환불을 API·store까지 보존하고, `seamless_generation_logs.diagnostics` JSONB/Alembic·admin safe projection을 추가했다. 프롬프트 원문과 allowlist로 투영한 확정 intent는 관리자 상세에서만 조회하고 목록에는 싣지 않는다. provider 응답·raw 내부 오류는 진단에 저장하거나 사용자에게 노출하지 않는다.*
- [x] stateless 확인: 프로세스-로컬 캐시·락 없음, 생성 예산 = Postgres 공유 카운터 — *모티프는 요청 스코프 MotifCatalog(DB 조회 → 엔진 명시 인자, 전역 registry는 테스트 폴백만). recraft 예산은 세션 행 조건부 UPDATE(+실패/reused 보상), finalize는 이후 계정당 24시간 쿼터로 재설계(generation_jobs 카운트 — failed/canceled 제외, 환불 로직 없음, worker-pipeline.md §5). freeze 캐시는 content-hash upsert로 대체*
- [x] GCS 연결(content-hash 키 + create-only) — *fabric은 content-hash key, preview는 request/candidate/content-hash key로 `if_generation_match=0` 업로드. 동일 객체 412만 멱등 성공이며 preview 업로드 장애는 key null+경고로 격하*
- [ ] 두 서비스 배포: worker-generate(동기 OIDC, 1vCPU/1GB) + worker-finalize(Cloud Tasks 푸시, 2vCPU/4GB, 동시성 1~2, dpi 상한 600) — *tofu에 서비스 구성·env/시크릿 결선·deploy.yml까지 완료 — **남은 것은 스테이징 개통 실행뿐**: `infra/README.md` 순서(2단계 apply·시크릿→`api.essesion.shop` 프록시 선개통→GitHub vars→main 푸시)*
- [x] api 연결: generate 동기 호출 + finalize 잡 등록/상태 조회(폴링), 세션 상태는 api 소유 — *Cloud Tasks는 job id 기반 결정적 task name, 동일 이름/409 성공 수렴, OIDC audience로 ambiguous enqueue를 멱등 재시도한다. worker가 이미 queued job을 claim한 경우 최신 job을 반환하고, 보상이 확정된 failed job에 늦게 도착한 task는 실행하지 않는다. design 수치는 NaN/Infinity를 거부하고 session/generate/motif seed는 signed-int64로 제한한다. generate 과금은 선차감·실패 환불.*

## 5. 프론트

- [x] 디자인 시스템(packages/shared) — 토큰(theme.css, 브랜드 #111111·라이트 온리) + 프리미티브 8종(Box/Flex/HStack/VStack/Grid/Float/Text/Icon, ResponsiveValue) + AI 하네스(`packages/shared/AGENTS.md` + `docs/foundation/` 17편). 검증: vitest 드리프트 가드 (store 임시 프리뷰는 store 재작성 완료 후 제거됨)
- [x] 디자인 시스템 컴포넌트 확장(33종, seed-design 참고·의존성 0 자체 구현) — ActionButton(Button 대체)·폼(TextField/Checkbox/RadioGroup/Switch/SegmentedControl/SelectBox/FieldButton/AttachmentDisplayField)·내비(Tabs/Menu)·피드백(HelpBubble)·디스플레이(Badge/Avatar/Skeleton/Divider/TagGroup/AspectRatio/ImageFrame/ProgressCircle)·콘텐츠(List/Accordion/Article/ContentPlaceholder/ResultSection)·셸(Layout/Footer/ScrollFog/PullToRefresh)·Chip/ToggleButton/FAB + 하네스 기계 강제(`scripts/check-harness.mjs`가 `pnpm lint`에 연결, 앱별 AGENTS.md 우선순위 사다리 + CLAUDE.md 싱크)
- [x] 오버레이·피드백 8종(AlertDialog/BottomSheet/SwipeableMenuSheet/SidePanel/Snackbar/Callout/PageBanner/HelpBubble) — 네이티브 `<dialog>`+Popover API(의존성 0, 포털·z-index 없음), `bg.overlay`·`bg.neutral-inverted` 토큰, **사용 구분 하네스**(`docs/foundation/overlay.md` 결정 트리·닫힘 모델 4분류 + AGENTS.md 압축 결정 표)
- [x] ResponsiveModal 세로 스크롤 회귀 수정 — *Modal·BottomSheet의 viewport 상한을 명시하고 dialog 대신 내부 콘텐츠 바디가 스크롤을 소유하도록 정리. SwipeableMenuSheet 긴 목록도 같은 계약으로 통일하고 회귀 테스트 3건, store/admin/shared 전체 JS gate와 Aside `/design` 콘텐츠 위 휠 스크롤을 검증.*
- [x] store/admin 공용 Header — YeongSeon public 로고만 이관(`logo/logo.png`), 메뉴 라벨·주소 유지, 흰색 `bg.layer-default` 상단 Header + 모바일 `SidePanel`, shared 토큰·컴포넌트 조합만 사용
- [x] store 실제 Footer — YeongSeon store 푸터 내용 기준, shared `Footer/FooterSection/FooterLink`와 토큰·프리미티브 조합만 사용
- [x] store Home 셸 — `/`는 Header/Footer 반응형 확인용 빈 홈
- [x] store 재작성 — 기존 라우트 기준, api-client만 사용(supabase-js 없음) — ***Home(`/`) 완료** (`apps/store/src/features/home` + `entities/product`, 플랜 `docs/plans/store-home.md`). **C1 shop(`/shop`, `/shop/:id`) 완료** — 현재 `/products` 계약(category/color/pattern/material/sort/limit)만 사용, PC 더 보기·모바일 무한 스크롤은 offset 없이 `limit` 증가 재조회 방식. 선행으로 api `/products`에 sort·limit 추가(+codegen), shared에 ImageFrame `fit` prop·`bg.image-scrim` 토큰 추가. **C2 cart(`/cart`) 완료** — 게스트 localStorage 장바구니 + 로그인 시 `/cart` 동기화, 선택/삭제/수량/옵션/쿠폰 적용 UI, 수선 옵션 전체·서버 스냅샷 금액 표시와 ResponsiveModal 옵션 변경, C1 상품 상세 담기 로직 공용 cart 모델로 이관. **C3 checkout(`/order/order-form`, `/order/payment/{success,fail}`) 완료** — 배송지 선택·신규 등록, 항목별 쿠폰, Toss PaymentWidget, pending 주문 재사용, success 멱등 confirm·장바구니 정리, stale 주문 취소 시 예약 쿠폰 복원, ProtectedRoute·인가 액션 로그인 확인 AlertDialog 포함. **C4 reform(`/reform`) 완료** — 자동/폭/복원 다중 선택과 조합 단가, 넥타이 다중 입력·전체선택·ResponsiveModal 일괄 적용, 단일 사진 AttachmentDisplayField, 키별 권장 길이·자동수선 영상·기본/딤플·폭 전후 비교 안내, 비회원 GCS 임시 업로드→로그인 cart claim, 담기 후 이동 선택, 수선 배송비 4,500원, C2 수선 편집과 C3 직접발송·방문수거/repair 성공 분기 연결. **C5 custom-order(`/custom-order`, `/order/custom-payment`) 완료** — 공개 계산 API 400ms 디바운스+입력 fingerprint 일치 가드, 재주문 원단 선택·과금, 수량·원단·봉제·사양·마감·첨부 섹션과 첫 오류 스크롤·필드 포커스, zod 검증 sessionStorage draft 복원, GCS 서명 업로드(최대 5장), 100개 기준 즉시 주문/견적 요청 분기와 로그인 후 연락처 기본값·배송지 선택, 배송지·쿠폰·Toss 결제 공용 CheckoutShell 재사용, 결제 실패/재확인 원래 주문서 복귀 포함. **C6 sample-order(`/sample-order`, `/order/sample-payment`) 완료** — 부작용 없는 공개 `/orders/sample/calculate` 추가(+api-client 재생성), 샘플 유형·원단·봉제·첨부 선택, GCS 업로드, 배송지·쿠폰·Toss 결제와 pending 복구 재사용. **C7 token(`/token/purchase`, `/token/purchase/payment`, success/fail) 완료** — 플랜/잔액 조회, 로그인 게이트, Toss 결제 재사용, 결제 confirm 멱등 처리와 잔액 캐시 갱신. **C8 my-page(`/my-page`, `/my-page/orders`, `/my-page/my-info`, `/my-page/my-info/{notice,leave}`, `/my-page/shipping`) 완료** — ContentLayout 허브·계정 상태, 프로필 수정, 휴대폰 인증+60초 재전송, 서비스/마케팅 알림, 이중 확인 탈퇴, 배송지 페이지+ResponsiveModal CRUD와 체크아웃 공용 주소 폼, 미검증 휴대폰 PATCH 경로 제거(+api-client 재생성). **C9 주문 내역·클레임(`/my-page/orders`, `/order/:orderId`, `/my-page/claims`, `/my-page/claims/:claimId`) 완료** — `customer_actions` 단일 정본과 활성 클레임 게이트, ClaimOut 주문/아이템·주문 상세 배송지 보강(+api-client 재생성), 구매확정·클레임 생성/취소, 타입·날짜 그룹 목록, 수선 입고 주소/복사·양방향 배송 정보, Aside 데스크톱/모바일 검증. **C9 팔로업 완료** — 토큰 환불 신청/취소 배선(주문 상세 섹션+클레임 상세, api 무변경)과 주문 배송지 스냅샷(Alembic `shipping_address_snapshot` + 백필 + 조회 스냅샷 우선, 스펙 무변경), 플랜 `docs/plans/store-order-claim-followups.md`. **C10 토큰 내역·문의·견적(`/my-page/token-history`, `/my-page/inquiry`, `/my-page/quote-request`, `/my-page/quote-request/:quoteId`) 완료** — 토큰 원장 페이지네이션·환불 신청/취소, 문의 작성/수정/삭제와 서버 상품 검색, 견적 목록/상세·custom-order 접수 이동, 소유권·만료·실제 객체를 검증하는 견적 이미지 스테이징, api-client 재생성, Aside 데스크톱/390px 모바일 검증 (`docs/plans/store-token-inquiry-quote.md`). **최종 검토·리팩토링(ponytail) 완료** — 임시 프리뷰 제거(−1.6k줄), custom/sample 결제 페이지 `OrderPaymentPage` 통합, token 결제 CheckoutShell 전환+zod draft 검증, `usePaymentConfirm`으로 confirm 멱등 스캐폴드 단일화, GCS 업로드 검증/서명 PUT 헬퍼 공용화, order-form 수거지 우편번호 검색 추가, cart 라인아이템 돈 경로 단위 테스트 12건. Aside로 토큰/샘플 결제·쿠폰 적용·draft 폴백·success invalid 분기 검증.*
- [x] 주문·클레임 통합 상태 표시 — DDL·money-first 상태기계 변경 없이 API 주문 읽기모델에 활성 우선·최신 클레임 요약/아이템 필드를 추가하고 api-client 재생성, store·admin 주문 목록/상세 배지와 취소 완료·반품·교환·토큰 환불·거부 매핑을 구현. 완료 취소는 고객 재요청·구매확정·수선 발송과 관리자 주문 상태·송장 변경을 API부터 차단하고, store에서는 CTA를 숨기며 admin에서는 사유와 함께 비활성화. 실제 PostgreSQL API 테스트와 store/admin 단위 테스트, 전체 빌드·타입체크·테스트, Aside 실데이터 화면 확인 완료 (`docs/plans/order-claim-status-display.md`)
- [x] 주문 내용 누락 방지 — custom·sample·repair 항목 사양/요청사항을 shared 디코더로 통합하고 store·admin 상세에 전 항목 렌더. 소유자/관리자 관계 검증 이미지 URL, 수선 수거·발송 읽기모델, 배송 요청 표시, 주문 유형 지역화, 멱등 로컬 시드를 추가하고 api-client 재생성. 실제 PostgreSQL 652건·store 174건·admin 111건·shared 51건, 빌드·타입체크·Aside 실데이터 화면 검증 완료 (`docs/plans/order-content-visibility.md`)
- [x] store C11 정적 페이지 — `/faq`·`/notice`·약관 3종 공개 라우트, 수선 요금 토큰 치환, 공지 고정 정렬, 마이페이지 고객지원 링크. 회사명 `영선산업`·상호명 `ESSE SION`·이메일 `biblecookie@naver.com`으로 통일하고, 운영 확정이 필요한 약관 책임자·시행일·수탁자 상세는 placeholder로 표시. Aside 데스크톱·390px 모바일·API 오류 폴백 검증 (`docs/plans/store-static.md`)
- [x] store 후기·공개 Q&A·서비스 안내 — *상품·수선·주문제작·샘플제작에 후기 공개 목록과 공개/비밀 문의, 주문 상세 후기 작성·조회·수정·삭제를 연결하고 custom/sample 안내를 추가. 정보·문의·후기는 한 스크롤에 동시 렌더하며 3등분 내비게이션은 Header 아래 sticky 앵커로 이동. shared Rating과 admin 후기 목록/필터/삭제·문의 비밀글 표시 포함. repo lint, Turbo build/typecheck/test, Python 666건, Aside 실제 DB 왕복·sticky 위치 검증 완료 (`docs/plans/store-reviews.md`)*
- [x] 사진 후기(리뷰 D9 이연분) — *후기는 공개 콘텐츠라 사진을 공개 assets 버킷에 두는 상품 이미지 패턴 재사용: `reviews/` prefix 스테이징 발급(`POST /reviews/photo-uploads`)→서명 PUT→complete→작성/수정 시 최대 5장 링크(`Review.photos` JSONB 순서 보존, 소유권·완료·prefix 검증), 교체/삭제 시 만료→cleanup 배치가 assets 버킷에서 삭제. 공개 목록·단건에 `photos[{upload_id,url}]` 동봉(`public_asset_url`, 서명 read URL 아님 — 공개 목록 signBlob 비용 회피). store 폼 즉시 업로드 AttachmentDisplayField·조회/목록 썸네일, admin 목록 사진 컬럼. pytest 3건 추가(671 통과)·api-client 재생성·Aside 작성→수정→공개 노출·admin 왕복 검증 (`docs/plans/store-reviews.md` §15)*
- [x] custom-order 선택 UI 의미 정합성 — 원단·타이·심지는 비교형 SelectBox, 사이즈는 RadioGroup, 즉시 입력 전환인 연락 방법만 SegmentedControl 유지
- [x] custom-order 정보 계층 정리 — 번호형 대분류는 유지하고 단일 내용은 제목에 통합, 복수 내용은 주문 방식·제작 수량·봉제 옵션·마감 옵션 소제목으로 일관되게 그룹화
- [x] custom-order 폴리 원단 계산 복구 — 로컬 가격 시드에 날염·선염 폴리 키 추가, 계산 API 회귀 테스트로 두 조합 검증
- [x] custom-order 입력 안내 정리 — 수량 조건은 HelpBubble로 이동, 넥타이 폭은 빈 초기값과 범위 placeholder 적용, 일반 주문 하단의 중복 안내 제거
- [x] custom-order 자동 타이 돌려묶기 — 자동 타이 전용 선택·수동 전환 시 해제, 무상 사양 저장과 서버 검증·회귀 테스트 적용
- [x] sample-order 사후 개선 — 가격 계산을 가격 결정 키 기반 TanStack Query 캐시로 전환, 원단·타이·심지 SelectBox 정합화, 유의사항·후속 쿠폰 안내, 첨부 5장 통일, draft 방어 파싱 테스트 보강. 단가 재책정 여부는 운영 근거 부재로 현행 유지(`docs/plans/store-sample-order.md` §5-D)
- [x] cart 빈 상태 라우팅 회귀 수정 — 빈 선택 상태의 참조를 보존해 무한 재렌더와 URL만 바뀌는 페이지 이동 정지 방지, 선택 동기화 단위 테스트 추가
- [x] `/design` 신규 기획·설계(seamless 플로우 기준 — 보존 예외) — 대화형 세션·생성/변형·후보 선택·SVG 미리보기·내보내기·finalize 작업 복구·완성 디자인 주문 첨부, 토큰 과금/실패 환불과 워커 응답 계약, 모바일/데스크톱 UI 및 api-client 동기화 완료 (`docs/plans/store-design.md`). 세션 삭제(`DELETE /design/sessions/{id}`, 턴 CASCADE·완성본은 SET NULL로 보존)와 내 완성본 목록·삭제(`DELETE /design/jobs/{id}`, 종결 상태만·GCS 산출물 정리 — 24h 쿼터 재설계 후 삭제 행은 카운트에서 제외)를 디자인 페이지에 추가 — 주문은 복사본 참조라 삭제와 무관. 현재 범위에서 제외한 기능은 완전한 SVG/Bezier 편집기이고, 저장 palette CRUD는 owner·수명주기·공유 요구가 없어 별도 도메인으로 이연한다. retrieval eval 하네스·워커 앱 레벨 예외 핸들러의 상태는 `docs/specs/worker-refactor.md` 하단 표를 참조한다.
- [x] `/design` 참고 사진·사용자 SVG 첨부 기준선 — *`+` 패널에서 사진 최대 5장과 SVG/내 모티프 합계 최대 2개를 선택하고 후보 수는 앵커 Menu에서 변경한다. 프롬프트 힌트는 제거했다. 사진은 private GCS staging→소유권·MIME·크기 검증→worker allowlist fetch→방향 보정·축소·메타데이터 제거 후 Gemini에 전달한다. SVG는 worker sanitize·normalize 후 사용자별 최대 100개 라이브러리에 저장하고 일반 검색/fingerprint에서 제외한 exact motif로 사용한다. 성공 시 첨부는 1회성 해제되지만 턴 이력에는 signed photo preview/불변 SVG preview가 남고, 세션 삭제 시 사진을 만료 처리한다. API-client 재생성과 실제 PostgreSQL 소유권·이력 테스트, worker 멀티모달·SSRF·private motif 테스트, store/shared 타입·UI 테스트 완료.*
- [x] `/design` 통합 생성 제어 확장 — *사진별 purpose, fixed palette, 패턴 제약, 통합 모티프(SVG·결정적 텍스트 path·로컬 사진 vectorize), 문맥 아이디어 helper를 구조화된 Store→API→worker 계약으로 구현. API가 private motif를 owner lock 아래 원자 저장하고 worker 변환·생성 catalog와 분리했다. OpenAPI codegen, Alembic `e7f9a1b2c3d4` 단일 head/current/check, lint, production env를 명시한 Turbo 10/10(build·typecheck·test: Store 223·Shared 83·Admin 205), Python 790, ruff, pyright, diff check 통과. Aside에서 데스크톱 5열×2행·390px 모바일 4열/bottom sheet, 사진 purpose Menu keyboard/focus, 색상 추출·초기화, 패턴 요약·초기화, SVG/텍스트/사진 모티프 preview·저장, 2개 제한·삭제 비중첩, exact motif promptless 생성 가능·사진만 promptless 생성 불가, 아이디어 편집/추가, 실패 후 prompt·사진/purpose·모티프·색상·패턴·후보 수 유지와 console/page error 0을 확인했다. 기존 서버를 재시작하지 않고 별도 임시 API/worker에서 palette extract, FontTools text preview, motif import(201)·삭제(204), Pillow+VTracer photo preview까지 실제 계약으로 왕복한 뒤 검증 데이터를 삭제하고 프로세스를 종료했다 (`docs/specs/design-generation-controls.md`).*
- [x] `/design` 생성 제어 리뷰 후속 — *색상 모달 snapshot 입력 의존성과 open 전환 가드를 명시하고, 턴 첨부 크기 유틸리티·사진 preview URL 병렬 서명·worker `layers` 명시 검증·OFL 문구·모티프 2개 경계 회귀 테스트와 Ruff 포맷을 정리했다. Store 224건·Python 791건(+179 subtests), store build/typecheck, Ruff check·변경 파일 format check·Pyright·하네스 통과.*
- [x] `/design` 요청 시각 표시 — *프롬프트 아래의 후보 수를 서버 턴 `created_at` 기준 요청 시각으로 교체하고 턴 피드 회귀 테스트를 추가했다.*
- [x] `/design` 문맥형 실패 UX — *저작·제약·참고 이미지·intent·후보 실패를 서로 다른 안내와 재시도 행동으로 표시하며 중복된 “요청을 이해하지 못했어요” 문구를 제거했다.*
- [ ] `/design` 세션 대화 문맥 — *별도 생성/수정 모드 없이 현재 세션의 선택된 semantic plan, intent와 최근 턴을 API가 읽어 다음 생성 문맥으로 구성한다. 새 세션만 빈 문맥으로 시작하며 상세 설계는 `docs/plans/design-conversation-memory.md`를 따른다.*
- [x] admin 재작성 개발 플랜 — 기존 25개 라우트 inventory, API 선행 계약, 수직 슬라이스·검증 기준과 추가 보안·동시성·운영 복구·접근성 검토 반영 (`docs/plans/admin-rewrite.md`)
- [x] admin 재작성 — 기존 라우트 기준 (`docs/plans/admin-rewrite.md`) — *A~J 구현 완료. 최신 전체 gate는 OpenAPI 128 paths drift 0, Python 651건(+147 subtests)·shared 49건·store 162건·admin 100건, repo lint/build/typecheck와 실제 PostgreSQL Playwright admin smoke 통과. Aside에서 1440/390/767/768/1024px·200% zoom, 대표 mutation·focus·reduced motion·ScrollFog·탭 간 logout 검증. 실제 GCP·Cloudflare 개통과 capability `real` 확인은 별도 배포 항목으로 인계.*
- [x] admin 검토 후 개선 — *편집 기준 revision 고정, 범위 밖 page URL 교정, invalid submit 첫 오류 focus, 동일 제목 라우트 focus, terminal/hidden polling 중단, dev port 3001 정합화 및 회귀 테스트.*
- [x] admin UI/UX 감사 후속 — *가격·설정·토큰·문의의 읽기/편집 분리, 고위험 변경 검토·안전한 멱등 재시도, URL 복원 상세 탭·상단 액션·기술 정보 접기, 모든 주요 목록의 가변 폭 검색+필터 버튼·KST 기간 필터 compact 툴바(데스크톱 SidePanel·모바일 BottomSheet)·페이지네이션, 제목 없는 Divider 메뉴 그룹, 생성 갱신 제어를 구현하고 자동 gate와 Aside 1440×900/390×844 화면을 검증 (`docs/reviews/admin-uiux-audit-2026-07.md`).*
- [x] admin/store 통합 개선 — *store refresh 단일 조정자·탭 간 세션 동기화, 라우트 오류/404/Sentry 골격, skip link·캐러셀 접근성, 홈 이미지 WebP srcset·폰트 subset(정적 자산 약 90% 절감), 수선 업로드 staging 검증, 쿠폰 대상 수 expected_count 동시성 가드, production env fail-fast와 CI 성공 SHA 배포 게이트 적용.*
- [x] 전체 감사 후 store/admin/shared 안정화 — *장바구니 replace·guest 동기화를 세션별 직렬 큐와 명시적 bearer에 묶어 계정 전환 오염을 차단하고, 토큰 revision별 `getMe` 재검증으로 same-account 회전은 캐시를 보존하되 cross-account 회전은 loading 경계에서 사용자를 교체. 디자인 생성·재시도·선택 operation epoch와 pending marker 소유권, custom quote debounced 유효성, ImageFrame 소스별 실패 상태, ScrollFog 자식 resize 관찰을 회귀 테스트로 고정. admin 상세 이미지는 `{upload_id}`/`{legacy_url}` 명시 ref와 `{url, upload_id}` 응답으로 순서·legacy 보존/삭제를 안전하게 재설계.*
- [x] 주문·생성 리뷰 후속 — *생성 로그 ID의 키보드 링크, shared DatePicker·claimBadge 단일화, 주문 상세 shared primitive 조합, 영수증별 사진 조회·주문 갤러리 분리, 이미지 만료 목록 필터, 클레임 경합 order advisory lock, store 사진 재시도를 회귀 테스트와 함께 반영.*
- [x] Seamless 생성 로그 진단 강화 — *`partial` 문자열 오분류를 제거해 후보 4/4와 모티프 drop·CMYK 경고를 분리하고, raw 8건을 원인별 건수로 표시. worker의 안전한 provider 구조 로그, prompt revision·단계별 시간·모티프 해석 diagnostics, `generation_log_id` 기반 세션 선택·재생성·finalize 결과를 admin 상세에 연결하고 api-client를 재생성했다.*
- [x] `/design` pgvector 모티프 grounding — *공개 motif의 Vertex AI `gemini-embedding-001` 3072차원 임베딩을 `embedding_vertex`에 멱등 backfill하고 ADC 기반 global top-5 검색을 사용한다. 기존 1536 legacy 컬럼은 무중단 전환을 위해 보존한다. prompt 후보는 exact token/0.84 gate 뒤 ID 없는 `catalog_ref`로 Gemini에 제공하며 direct SVG·텍스트·사진·내 모티프와 motif 사진의 2슬롯 우선순위를 API 과금 전 검증한다.*
- [x] `/design` V3 retrieval 트랜잭션 격리 — *fail-soft 예시 검색을 요청 세션과 분리해 검색 DB 오류 뒤에도 모티프 해석·생성 로그 저장이 정상 진행되도록 하고, Gemini 호출의 await·prompt 전달 회귀 검증을 보강했다.*
- [x] admin 리뷰 지적 후속 — *수선 발송 사유 지역화, 목록 초기화 시 테이블 설정 보존, 고객 필터 shared primitive 재구성, 작업 초안 전환·이동 차단, 견적 옵션 라벨, 저장 직후 캐시 반영, 공통 검색·필터 접근성, 시맨틱 크기·레이어와 Skeleton 프리셋을 회귀 테스트로 고정하고 Aside 1440×900/390×844 화면을 검증.*
- [ ] Cloudflare Workers 배포(Vite build + Wrangler Static Assets) — *API proxy는 첫 비로컬 API 배포 전에 별도 선개통, app/admin 고정 custom-domain route는 설정 완료. 실제 배포·DNS 확인이 남음. api `min-instances=1`은 프로덕션 OpenTofu 변수로 별도 적용.*
- [x] Playwright 스모크 1줄기: 로그인 → 장바구니 → 주문 → 결제 — *실제 API + PostgreSQL seed, 브라우저에서는 결정적 Toss 로컬 어댑터, API는 DryRun confirm으로 멱등 재호출과 장바구니 정리까지 검증. 실제 Toss sandbox는 스테이징 자격 증명 주입 후 리허설에서 별도 확인.*
- [x] Playwright admin 스모크: 관리자 로그인 → 보호 목록/상세 → 대표 상태 변경 → 로그아웃 (실제 API + PostgreSQL seed) — *`e2e/admin-smoke.spec.ts`·CI 연결과 최종 스키마/codegen 상태의 로컬 실행 1건 통과*

## 6. 리허설 (스테이징)

- [ ] 변환 스크립트로 운영 데이터 이관 → 매핑 표 대비 검증
- [ ] 이미지 수동 재등록
- [ ] E2E: 소셜 로그인 4종 / 주문·결제·클레임 / 생성(generate → finalize 큐 → 결과 수신)
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] Gemini로 전송되는 재인코딩 참고 사진의 처리 지역·학습 사용·로그/abuse monitoring 보존·삭제 제어·DPA·사용자 고지를 실제 계약·프로젝트 설정 기준으로 privacy owner가 승인
- [ ] 회원 탈퇴 후 역사성 개인정보 필드별 보존 목적·기간·접근 통제·분리 저장·만료 시 익명화/삭제 정책을 privacy owner·법률 검토자가 승인
- [ ] 주문/클레임/견적/문의/수선/이미지/디자인 job·관리자 로그 샘플로 purge·익명화 배치와 복구 불가성을 검증

## 7. 컷오버

- [ ] 프로덕션 GCP 프로젝트 프로비저닝(OpenTofu 재사용)
- [ ] 프로바이더 redirect URI·Toss 웹훅 URL을 프로덕션 `api.<domain>` 값으로 등록(run.app 직통 금지)
- [ ] 쓰기 동결 공지 → 최종 데이터 이관 → 매핑 표 검증
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 절차 문서화(DNS 원복 — 동결 해제 전까지 데이터 무손실)
- [ ] 역사성 개인정보 보존·익명화 정책과 자동 배치가 승인·검증됐는지 production gate에서 재확인
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
