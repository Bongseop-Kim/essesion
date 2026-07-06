# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md) (§8 마이그레이션 순서). 단계 순서대로 진행하되, **0단계(사전 준비)는 리드타임이 있으므로 지금 바로 착수**.

## 0. 사전 준비 (리드타임 — 즉시 착수)

- [ ] Apple Developer 계정 + Sign in with Apple 키·도메인 검증 신청
- [ ] Naver 개발자 앱 등록
- [ ] Google·Kakao 콘솔 확인, 새 redirect URI 등록 준비(도메인 확정 후 등록)
- [ ] Toss 시크릿 키 확인 + 웹훅/콜백 URL 이전 계획
- [ ] Solapi API 키 확보
- [ ] 기존 생성 로그에서 finalize 실제 dpi 실측 → 워커 메모리 산정 근거
- [ ] Supabase Auth 트랜잭션 이메일(가입 확인 등) 존재 여부 확인 → 필요 시 Resend
- [ ] 기존 env 전체 수집 (YeongSeon + seamless-tile)

## 1. 골격

- [ ] 모노레포 스캐폴드: pnpm workspace(+catalogs) + Turborepo, uv workspace(apps/api·worker), mise 툴체인 핀
- [ ] 디렉토리 뼈대: `apps/{store,admin,api,worker}`, `packages/{api-client,shared,tsconfig}`, `db/`, `infra/`
- [ ] 로컬: docker compose(Postgres + pgvector)
- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF
- [ ] Cloudflare: 서브도메인(app/admin/api) + api 프록시(WAF·레이트리밋), wrangler 배포 설정
- [ ] CI(GitHub Actions): 빌드·린트(Biome / ruff+pyright)·테스트·배포, PR 프리뷰(Cloudflare 프리뷰 URL + Cloud Run 태그 리비전)
- [ ] GitHub secret scanning + push protection 켜기, osv-scanner CI 스텝
- [ ] Renovate 설정(묶음 PR)
- [ ] GCP 예산 알림 1개 + uptime check 1개
- [ ] Sentry 프로젝트(api·worker) 연결, JSON 구조화 로깅 + request_id 전파 골격
- [ ] Secret Manager에 기존 env 배치

## 2. 스키마 재설계

- [ ] 기존 스키마 전수 검토(YeongSeon `supabase/schemas`)
- [ ] 새 스키마 설계 — 도메인·데이터 의미 보존, generate-tile 잔재(ai_generation_logs 등)·LangGraph checkpoint·미사용 뷰 제외, DB함수 로직은 api로
- [ ] **기존→새 스키마 매핑 표 작성** — 변환 스크립트·동작 검증·"재설계가 기능 개편으로 번지는 것"을 막는 기준 문서
- [ ] Alembic 첫 리비전 생성 → 스테이징 적용
- [ ] 데이터 변환 스크립트 초안(상품·단가·모티프 등 — 유저·이미지 제외)

## 3. api 1차

- [ ] Auth 골격: JWT(access 단명 + refresh 회전), argon2id
- [ ] id/pw 로그인 — 공개 가입 없음, 계정은 시드/관리자 생성만
- [ ] 소셜 OAuth(Authlib): Google → Kakao → Apple → Naver 순
- [ ] 휴대폰 인증(Solapi)
- [ ] 인가 3규칙 구현(공개 조회 = 상품·찜 / 나머지 owner-only / 관리자 별도 역할) + **testcontainers 403 테스트**
- [ ] 도메인 모듈 — 돈 경로 우선: 주문 3종(일반/맞춤/샘플) → Toss 결제(**웹훅 서명 검증 + 이벤트 ID 멱등**) → 토큰 과금 → 클레임/배송지/문의/견적/쿠폰/장바구니/찜/마이페이지
- [ ] GCS 서명 업로드 URL 발급(ImageKit 대체) + 회원 탈퇴 + 정리 배치(Cloud Scheduler → api)
- [ ] OpenAPI 스펙 확정 → api-client 코드젠(Hey API + TanStack Query + zod) → **CI 드리프트 검사**
- [ ] schemathesis CI 스텝

## 4. worker

- [ ] 엔진 재구현: compose/candidates/placement + 모티프 검색(pgvector)
- [ ] resvg 인프로세스 래스터화 동등성 검증 → 실패 시 librsvg 서브프로세스 폴백
- [ ] finalize 파이프라인 재설계(중간 산출물 재사용 — 4~5회 재실행 승계 금지) + export
- [ ] **결정론 계약 대조 테스트**: 같은 intent+seed → byte-identical SVG (기존 seamless-tile 테스트 50+개 기준)
- [ ] stateless 확인: 프로세스-로컬 캐시·락 없음, 생성 예산 = Postgres 공유 카운터
- [ ] GCS 연결(content-hash 키 + upsert)
- [ ] 두 서비스 배포: worker-generate(동기 OIDC, 1vCPU/1GB) + worker-finalize(Cloud Tasks 푸시, 2vCPU/4GB, 동시성 1~2, dpi 상한 600)
- [ ] api 연결: generate 동기 호출 + finalize 잡 등록/상태 조회(폴링/SSE), 세션 상태는 api 소유

## 5. 프론트

- [ ] store 재작성 — 기존 라우트 기준, api-client만 사용(supabase-js 없음)
- [ ] `/design` 신규 기획·설계(seamless 플로우 기준 — 보존 예외)
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
