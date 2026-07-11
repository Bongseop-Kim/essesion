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
- [x] Aside 브라우저 확인 하네스 — *프로젝트 MCP(`.mcp.json`) + `.claude/skills/aside-browser/SKILL.md`, CLI 로그인·MCP 등록 확인*
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

- [x] 디자인 시스템(packages/shared) — 토큰(theme.css, 브랜드 #111111·라이트 온리) + 프리미티브 8종(Box/Flex/HStack/VStack/Grid/Float/Text/Icon, ResponsiveValue) + AI 하네스(`packages/shared/AGENTS.md` + `docs/foundation/` 17편). 검증: vitest 드리프트 가드 (store 임시 프리뷰는 store 재작성 완료 후 제거됨)
- [x] 디자인 시스템 컴포넌트 확장(33종, seed-design 참고·의존성 0 자체 구현) — ActionButton(Button 대체)·폼(TextField/Checkbox/RadioGroup/Switch/SegmentedControl/SelectBox/FieldButton/AttachmentDisplayField)·내비(Tabs/Menu)·피드백(HelpBubble)·디스플레이(Badge/Avatar/Skeleton/Divider/TagGroup/AspectRatio/ImageFrame/ProgressCircle)·콘텐츠(List/Accordion/Article/ContentPlaceholder/ResultSection)·셸(Layout/Footer/ScrollFog/PullToRefresh)·Chip/ToggleButton/FAB + 하네스 기계 강제(`scripts/check-harness.mjs`가 `pnpm lint`에 연결, 앱별 AGENTS.md 우선순위 사다리 + CLAUDE.md 싱크)
- [x] 오버레이·피드백 8종(AlertDialog/BottomSheet/SwipeableMenuSheet/SidePanel/Snackbar/Callout/PageBanner/HelpBubble) — 네이티브 `<dialog>`+Popover API(의존성 0, 포털·z-index 없음), `bg.overlay`·`bg.neutral-inverted` 토큰, **사용 구분 하네스**(`docs/foundation/overlay.md` 결정 트리·닫힘 모델 4분류 + AGENTS.md 압축 결정 표)
- [x] store/admin 공용 Header — YeongSeon public 로고만 이관(`logo/logo.png`), 메뉴 라벨·주소 유지, 흰색 `bg.layer-default` 상단 Header + 모바일 `SidePanel`, shared 토큰·컴포넌트 조합만 사용
- [x] store 실제 Footer — YeongSeon store 푸터 내용 기준, shared `Footer/FooterSection/FooterLink`와 토큰·프리미티브 조합만 사용
- [x] store Home 셸 — `/`는 Header/Footer 반응형 확인용 빈 홈, 디자인 시스템 Preview는 `/__preview`로 분리
- [x] store 재작성 — 기존 라우트 기준, api-client만 사용(supabase-js 없음) — ***Home(`/`) 완료** (`apps/store/src/features/home` + `entities/product`, 플랜 `docs/plans/store-home.md`). **C1 shop(`/shop`, `/shop/:id`) 완료** — 현재 `/products` 계약(category/color/pattern/material/sort/limit)만 사용, PC 더 보기·모바일 무한 스크롤은 offset 없이 `limit` 증가 재조회 방식. 선행으로 api `/products`에 sort·limit 추가(+codegen), shared에 ImageFrame `fit` prop·`bg.image-scrim` 토큰 추가. **C2 cart(`/cart`) 완료** — 게스트 localStorage 장바구니 + 로그인 시 `/cart` 동기화, 선택/삭제/수량/옵션/쿠폰 적용 UI, 수선 옵션 전체·서버 스냅샷 금액 표시와 ResponsiveModal 옵션 변경, C1 상품 상세 담기 로직 공용 cart 모델로 이관. **C3 checkout(`/order/order-form`, `/order/payment/{success,fail}`) 완료** — 배송지 선택·신규 등록, 항목별 쿠폰, Toss PaymentWidget, pending 주문 재사용, success 멱등 confirm·장바구니 정리, stale 주문 취소 시 예약 쿠폰 복원, ProtectedRoute·인가 액션 로그인 확인 AlertDialog 포함. **C4 reform(`/reform`) 완료** — 자동/폭/복원 다중 선택과 조합 단가, 넥타이 다중 입력·전체선택·ResponsiveModal 일괄 적용, 단일 사진 AttachmentDisplayField, 키별 권장 길이·자동수선 영상·기본/딤플·폭 전후 비교 안내, 비회원 GCS 임시 업로드→로그인 cart claim, 담기 후 이동 선택, 수선 배송비 4,500원, C2 수선 편집과 C3 직접발송·방문수거/repair 성공 분기 연결. **C5 custom-order(`/custom-order`, `/order/custom-payment`) 완료** — 공개 계산 API 400ms 디바운스+입력 fingerprint 일치 가드, 재주문 원단 선택·과금, 수량·원단·봉제·사양·마감·첨부 섹션과 첫 오류 스크롤·필드 포커스, zod 검증 sessionStorage draft 복원, GCS 서명 업로드(최대 5장), 100개 기준 즉시 주문/견적 요청 분기와 로그인 후 연락처 기본값·배송지 선택, 배송지·쿠폰·Toss 결제 공용 CheckoutShell 재사용, 결제 실패/재확인 원래 주문서 복귀 포함. **C6 sample-order(`/sample-order`, `/order/sample-payment`) 완료** — 부작용 없는 공개 `/orders/sample/calculate` 추가(+api-client 재생성), 샘플 유형·원단·봉제·첨부 선택, GCS 업로드, 배송지·쿠폰·Toss 결제와 pending 복구 재사용. **C7 token(`/token/purchase`, `/token/purchase/payment`, success/fail) 완료** — 플랜/잔액 조회, 로그인 게이트, Toss 결제 재사용, 결제 confirm 멱등 처리와 잔액 캐시 갱신. **C8 my-page(`/my-page`, `/my-page/orders`, `/my-page/my-info`, `/my-page/my-info/{notice,leave}`, `/my-page/shipping`) 완료** — ContentLayout 허브·계정 상태, 프로필 수정, 휴대폰 인증+60초 재전송, 서비스/마케팅 알림, 이중 확인 탈퇴, 배송지 페이지+ResponsiveModal CRUD와 체크아웃 공용 주소 폼, 미검증 휴대폰 PATCH 경로 제거(+api-client 재생성). **C9 주문 내역·클레임(`/my-page/orders`, `/order/:orderId`, `/my-page/claims`, `/my-page/claims/:claimId`) 완료** — `customer_actions` 단일 정본과 활성 클레임 게이트, ClaimOut 주문/아이템·주문 상세 배송지 보강(+api-client 재생성), 구매확정·클레임 생성/취소, 타입·날짜 그룹 목록, 수선 입고 주소/복사·양방향 배송 정보, Aside 데스크톱/모바일 검증. **C9 팔로업 완료** — 토큰 환불 신청/취소 배선(주문 상세 섹션+클레임 상세, api 무변경)과 주문 배송지 스냅샷(Alembic `shipping_address_snapshot` + 백필 + 조회 스냅샷 우선, 스펙 무변경), 플랜 `docs/plans/store-order-claim-followups.md`. **C10 토큰 내역·문의·견적(`/my-page/token-history`, `/my-page/inquiry`, `/my-page/quote-request`, `/my-page/quote-request/:quoteId`) 완료** — 토큰 원장 페이지네이션·환불 신청/취소, 문의 작성/수정/삭제와 서버 상품 검색, 견적 목록/상세·custom-order 접수 이동, 소유권·만료·실제 객체를 검증하는 견적 이미지 스테이징, api-client 재생성, Aside 데스크톱/390px 모바일 검증 (`docs/plans/store-token-inquiry-quote.md`). **최종 검토·리팩토링(ponytail) 완료** — 임시 프리뷰 제거(−1.6k줄), custom/sample 결제 페이지 `OrderPaymentPage` 통합, token 결제 CheckoutShell 전환+zod draft 검증, `usePaymentConfirm`으로 confirm 멱등 스캐폴드 단일화, GCS 업로드 검증/서명 PUT 헬퍼 공용화, order-form 수거지 우편번호 검색 추가, cart 라인아이템 돈 경로 단위 테스트 12건. Aside로 토큰/샘플 결제·쿠폰 적용·draft 폴백·success invalid 분기 검증.*
- [x] store C11 정적 페이지 — `/faq`·`/notice`·약관 3종 공개 라우트, 수선 요금 토큰 치환, 공지 고정 정렬, 마이페이지 고객지원 링크. 회사명 `영선산업`·상호명 `ESSE SION`·이메일 `biblecookie@naver.com`으로 통일하고, 운영 확정이 필요한 약관 책임자·시행일·수탁자 상세는 placeholder로 표시. Aside 데스크톱·390px 모바일·API 오류 폴백 검증 (`docs/plans/store-static.md`)
- [x] custom-order 선택 UI 의미 정합성 — 원단·타이·심지는 비교형 SelectBox, 사이즈는 RadioGroup, 즉시 입력 전환인 연락 방법만 SegmentedControl 유지
- [x] custom-order 정보 계층 정리 — 번호형 대분류는 유지하고 단일 내용은 제목에 통합, 복수 내용은 주문 방식·제작 수량·봉제 옵션·마감 옵션 소제목으로 일관되게 그룹화
- [x] custom-order 폴리 원단 계산 복구 — 로컬 가격 시드에 날염·선염 폴리 키 추가, 계산 API 회귀 테스트로 두 조합 검증
- [x] custom-order 입력 안내 정리 — 수량 조건은 HelpBubble로 이동, 넥타이 폭은 빈 초기값과 범위 placeholder 적용, 일반 주문 하단의 중복 안내 제거
- [x] custom-order 자동 타이 돌려묶기 — 자동 타이 전용 선택·수동 전환 시 해제, 무상 사양 저장과 서버 검증·회귀 테스트 적용
- [x] sample-order 사후 개선 — 가격 계산을 가격 결정 키 기반 TanStack Query 캐시로 전환, 원단·타이·심지 SelectBox 정합화, 유의사항·후속 쿠폰 안내, 첨부 5장 통일, draft 방어 파싱 테스트 보강. 단가 재책정 여부는 운영 근거 부재로 현행 유지(`docs/plans/store-sample-order.md` §5-D)
- [x] cart 빈 상태 라우팅 회귀 수정 — 빈 선택 상태의 참조를 보존해 무한 재렌더와 URL만 바뀌는 페이지 이동 정지 방지, 선택 동기화 단위 테스트 추가
- [x] `/design` 신규 기획·설계(seamless 플로우 기준 — 보존 예외) — 대화형 세션·생성/변형·후보 선택·SVG 미리보기·내보내기·finalize 작업 복구·완성 디자인 주문 첨부, 토큰 과금/실패 환불과 워커 응답 계약, 모바일/데스크톱 UI 및 api-client 동기화 완료 (`docs/plans/store-design.md`). **이연 기능 목록은 `docs/specs/worker-refactor.md` "범위 밖" 표 참조**: glyph(텍스트-as-모티프), 이미지 입력 경로(reference_image·vectorize), 대화형 편집 도구, `/palettes` 프리셋, retrieval eval 하네스, 워커 앱 레벨 예외 핸들러
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
