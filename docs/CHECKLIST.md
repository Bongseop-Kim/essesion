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
- [x] 로컬: docker compose(Postgres + pgvector)
- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF — *IaC 작성 완료(+ migrate Cloud Run job, Cloud Scheduler 배치 3종, scheduler SA — 점검 F2·F3 반영. deploy.yml에 마이그레이션 스텝 포함). **4단계(워커 배포) 착수 시 수행**: `infra/README.md` 부트스트랩 후 `tofu apply` — Cloud Tasks·OIDC는 로컬 에뮬레이터가 없어 그전까지는 전부 로컬(compose + `.env`)로 개발*
- [ ] Cloudflare: 서브도메인(app/admin/api) + api 프록시(WAF·레이트리밋), wrangler 배포 설정 — *wrangler 설정·프록시 워커 완료. **도메인 확정: `essesion.shop`** — routes 주석에 반영됨. **5단계(프론트 배포) 시 수행**: zone 추가·routes 해제·WAF 규칙(`infra/cloudflare/README.md`, 운영자 목록 `docs/OPERATOR-CHECKLIST.md` §C)*
- [x] CI(GitHub Actions): 빌드·린트(Biome / ruff+pyright)·테스트·배포, PR 프리뷰(Cloudflare 프리뷰 URL + Cloud Run 태그 리비전) — *배포·프리뷰 잡은 GitHub vars 설정 전까지 자동 스킵*
- [x] GitHub secret scanning + push protection 켜기, osv-scanner CI 스텝
- [x] Renovate 설정(묶음 PR) — *레포에 Renovate GitHub App 설치 필요*
- [ ] GCP 예산 알림 1개 + uptime check 1개 — *tofu에 포함, **4단계 apply 시 함께 생성***
- [ ] Sentry 프로젝트(api·worker) 연결, JSON 구조화 로깅 + request_id 전파 골격 — *골격(`libs/obs`) 완료, 로컬은 DSN 없으면 no-op. **4단계 착수 시**: Sentry 프로젝트 생성·DSN 주입*
- [ ] Secret Manager에 기존 env 배치 — *시크릿 컨테이너는 tofu 소유. **4단계 apply 후** `infra/README.md`의 gcloud 명령으로 값 주입 — 그전까지 로컬 `.env`*

## 2. 스키마 재설계

- [x] 기존 스키마 전수 검토(YeongSeon `supabase/schemas`) — *enum·뷰 19종·DB함수 ~40종·트리거 17종·부분 인덱스까지 대조*
- [x] 새 스키마 설계 — 도메인·데이터 의미 보존, generate-tile 잔재(ai_generation_logs 등)·LangGraph checkpoint·미사용 뷰 제외, DB함수 로직은 api로 — *33테이블, `db/src/db/models/`*
- [x] **기존→새 스키마 매핑 표 작성** — `db/MAPPING.md` (테이블·함수/트리거 소유 이동·이관 정책)
- [x] Alembic 첫 리비전 생성 → 스테이징 적용 — *베이스라인 리비전 생성·로컬 적용·`alembic check` 드리프트 0. 스테이징 적용은 4단계 tofu apply 후*
- [x] 데이터 변환 스크립트 초안(상품·단가·모티프 등 — 유저·이미지 제외) — *`db/scripts/migrate_data.py`, 유저 종속은 3단계 유저 매칭 확정 후 스텁 해제*

## 3. api 1차

- [x] Auth 골격: JWT(access 단명 + refresh 회전), argon2id — *refresh는 불투명 토큰 sha256 저장, 재사용 감지 시 전체 무효화*
- [x] id/pw 로그인 — 공개 가입 없음, 계정은 시드/관리자 생성만 — *`apps/api/scripts/seed.py`*
- [x] 소셜 OAuth(Authlib): Google → Kakao → Apple → Naver 순 — *Google·Kakao 완료(사용자 지정), Apple·Naver는 준비물 도착 후 oauth.py에 등록만 추가*
- [x] 휴대폰 인증(Solapi) — *재전송 60초/일 5회/만료 5분, 시크릿 없으면 DryRun*
- [x] 인가 3규칙 구현(공개 조회 = 상품·찜 / 나머지 owner-only / 관리자 별도 역할) + **testcontainers 403 테스트** — *테이블 주도 매트릭스(tests/authz.py), 도메인 추가 시 행 추가*
- [x] 도메인 모듈 — 돈 경로 우선: 주문 3종(일반/맞춤/샘플) → Toss 결제 → 토큰 과금 → 클레임/배송지/문의/견적/쿠폰/장바구니/찜/마이페이지 — *승인은 successUrl 콜백 confirm(Toss 구조상 원천) + 자동 대사 2겹: ALREADY_PROCESSED 조회 복구, `/payments/webhook` 조회 재검증 대사(money.md §9). 웹훅 URL 등록은 4단계 스테이징 개통 시. 토큰 과금은 원장·환불·`/design/generate` 차감 연동까지 완료*
- [x] GCS 서명 업로드 URL 발급(ImageKit 대체) + 회원 탈퇴 + 정리 배치(Cloud Scheduler → api) — *배치 3종 `/batch/*`, 4단계에서 Scheduler OIDC 연결*
- [x] OpenAPI 스펙 확정 → api-client 코드젠(Hey API + TanStack Query + zod) → **CI 드리프트 검사** — *`pnpm codegen`, ci.yml codegen-drift 잡*
- [x] schemathesis CI 스텝 — *pytest 통합(tests/test_contract.py) — CI py 잡에 포함*

## 4. worker

- [x] 엔진 재구현: compose/candidates/placement + 모티프 검색(pgvector) — *compose/placement(4종)/seamless/validate/candidates + pgvector motif store/resolver(검색 사다리: exact→scope→τ=0.84→Recraft 생성) + 어댑터 3종(OpenAI 임베딩·Recraft·Gemini, httpx 직접·키 없으면 503) + prompt→intent 경로 완료. 골든 25 intent byte-identical 유지*
- [x] resvg 인프로세스 래스터화 동등성 검증 → 실패 시 librsvg 서브프로세스 폴백 — *판정 (b) 조건부: resvg-py 0.3.3 vs rsvg-convert 2.62.3, 골든 27종 치수 완전 일치·형상/색/채움 동일, 차이는 도형 경계 AA에 100% 국한(색경계 ≤1.5px, 침식 2회 소멸). byte-identical 미달이라 즉시 채택 불가. librsvg 기준선 유지·코드 무변경. 전환 시 fabric 골든 재베이스라인 전제. 상세: `docs/reviews/resvg-parity.md`*
- [x] finalize 파이프라인 재설계(중간 산출물 재사용 — 4~5회 재실행 승계 금지) + export — *yarn_dyed·material_map·relief 재설계 완료: 별칭 슬롯 라벨 세그먼트 1회로 마스크 파생, 렌더 호출 최악 5회→3회(테스트가 카운트 assert). weave 에셋 7종, FinalizeRequest 4필드(weave/material_map/texture_strength/relief_strength)*
- [x] **결정론 계약 대조 테스트**: 같은 intent+seed → byte-identical SVG (기존 seamless-tile 테스트 50+개 기준) — *원본 엔진 재실행으로 추출한 골든 25종(+seed 변형·candidates 세트)을 엔진 계산으로 byte-identical 통과 + PYTHONHASHSEED 0/1/12345 교차. 원본 테스트 계층 이식 완료(래스터 seam 가드·motif_id parity·geometry·엔진 엣지 — 워커 278건)*
- [x] 리팩토링(원본 대조 점검 후속): config 검증·defusedxml·resolver 가드·어댑터 수명·stripe 정규화·/export 배선·프리뷰 병렬화·render/weave 분리 — *스펙 `docs/specs/worker-refactor.md`(R1~R15 완료, glyph·이미지 경로 등은 5단계 트랙), 실행 기록 `docs/plans/worker-refactor.md`*
- [x] stateless 확인: 프로세스-로컬 캐시·락 없음, 생성 예산 = Postgres 공유 카운터 — *모티프는 요청 스코프 MotifCatalog(DB 조회 → 엔진 명시 인자, 전역 registry는 테스트 폴백만). finalize·recraft 예산 둘 다 세션 행 조건부 UPDATE(+실패/reused 보상). freeze 캐시는 content-hash upsert로 대체*
- [x] GCS 연결(content-hash 키 + upsert) — *worker object store(DryRun/GCS) + fabric content-hash key + preview upload key 구현*
- [ ] 두 서비스 배포: worker-generate(동기 OIDC, 1vCPU/1GB) + worker-finalize(Cloud Tasks 푸시, 2vCPU/4GB, 동시성 1~2, dpi 상한 600) — *tofu에 서비스 구성·env/시크릿 결선·deploy.yml까지 완료 — **남은 것은 스테이징 개통 실행뿐**: `infra/README.md` "개통 체크리스트"(부트스트랩→2단계 apply→시크릿 주입→GitHub vars→main 푸시)*
- [x] api 연결: generate 동기 호출 + finalize 잡 등록/상태 조회(폴링/SSE), 세션 상태는 api 소유 — *worker client + Cloud Tasks REST enqueue(DryRun fallback) + job polling + generate 과금(use_tokens 선차감·실패 환불). SSE는 미구현*

## 5. 프론트

- [x] 디자인 시스템(packages/shared) — 토큰(theme.css, 브랜드 #111111·라이트 온리) + 프리미티브 8종(Box/Flex/HStack/VStack/Grid/Float/Text/Icon, ResponsiveValue) + AI 하네스(`packages/shared/AGENTS.md` + `docs/foundation/` 17편). 검증: vitest 드리프트 가드 + store 임시 프리뷰(main.tsx, 5단계 재작성 시 소멸)
- [ ] store 재작성 — 기존 라우트 기준, api-client만 사용(supabase-js 없음)
- [ ] `/design` 신규 기획·설계(seamless 플로우 기준 — 보존 예외) — **이 기획에서 결정·구현할 이연 기능 목록은 `docs/specs/worker-refactor.md` "범위 밖" 표 참조**: glyph(텍스트-as-모티프), 이미지 입력 경로(reference_image·vectorize), 대화형 편집 도구, `/palettes` 프리셋, retrieval eval 하네스, 워커 앱 레벨 예외 핸들러
- [ ] admin 재작성 — 기존 라우트 기준
- [ ] Cloudflare Workers 배포(Vite 플러그인 + wrangler), api는 min-instances=1 설정
- [ ] Playwright 스모크 1줄기: 로그인 → 장바구니 → 주문 → 결제(Toss 샌드박스)

## 6. 리허설 (스테이징)

- [ ] 변환 스크립트로 운영 데이터 이관 → 매핑 표 대비 검증
- [ ] 이미지 수동 재등록
- [ ] E2E: 소셜 로그인 4종 / 주문·결제·클레임 / 생성(generate → finalize 큐 → 결과 수신)
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정

## 7. 컷오버

- [ ] 프로덕션 GCP 프로젝트 프로비저닝(OpenTofu 재사용)
- [ ] 프로바이더 redirect URI·Toss 웹훅 URL 프로덕션 값 등록
- [ ] 쓰기 동결 공지 → 최종 데이터 이관 → 매핑 표 검증
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 절차 문서화(DNS 원복 — 동결 해제 전까지 데이터 무손실)
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
