# essesion

YeongSeon(커머스 프론트 + Supabase)과 seamless-tile(FastAPI 이미지 생성)을 GCP 기반 단일 모노레포로 통합 재구현. Supabase는 완전 제거.

## 필독
- `ARCHITECTURE.md` — 모든 설계 결정·스택·이관 순서. 구조에 손대기 전 반드시 읽을 것.
- `docs/CHECKLIST.md` — 실행 체크리스트. 작업 완료 시 체크 상태를 갱신할 것.

## 대원칙 (위반 금지)
- 기존 코드 이식 금지 — 전부 새로 작성. 단 기능 명세("무엇을 하는가")는 기존과 동일하게 재현. 기능 개편 금지.
- 스키마는 기존 검토 후 재설계하되 도메인·데이터 의미는 보존. 스키마 변경은 Alembic(`db/`) 경유만 — DDL 직접 실행 금지.
- 프론트에서 supabase-js 금지 — 서버 통신은 `packages/api-client`(OpenAPI 생성물)만 사용.
- api 스펙 변경 시 api-client를 재생성해 함께 커밋 (CI가 드리프트 검사).
- 시크릿 커밋 금지 — GCP는 Secret Manager, 로컬은 `.env`.

## 참고 레포 (읽기 전용, 코드 복사 금지)
- `/Users/duegosystem/git/YeongSeon` — 기능 명세의 원본 (라우트·엣지펑션이 기능 목록).
- `/Users/duegosystem/git/seamless-tile` — 워커의 동작 기준선. 같은 intent+seed → byte-identical SVG 계약과 기존 테스트 50+개를 대조 기준으로 사용.

## 명령어 (스캐폴드 후 실제 값으로 갱신할 것)
- JS: `pnpm turbo build|lint|test` (pnpm workspace + catalogs, 린트/포맷 = Biome)
- Python: `uv run pytest`, 린트/타입 = ruff + pyright (uv workspace: apps/api, apps/worker)
- 로컬 DB: `docker compose up` (Postgres + pgvector 하나만)
- 배포: 프론트 = wrangler(Cloudflare Workers), api·worker = Cloud Run (CI 경유)

## 도메인 규칙
- 인가: 상품·찜/좋아요는 공개 조회, 그 외 리소스는 소유자 본인만, 관리자는 별도 역할. 인가 테스트는 mock 금지 — testcontainers(실제 Postgres)로.
- 결제(Toss)·토큰 과금 로직은 api에만 둔다. 워커는 이미지 생성만.
- id/pw 로그인은 테스트용 — 공개 회원가입 없음, 계정은 시드/관리자로만 생성.
