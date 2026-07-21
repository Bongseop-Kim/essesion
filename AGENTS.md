# essesion

YeongSeon(커머스 프론트 + Supabase)과 seamless-tile(FastAPI 이미지 생성)을 GCP 기반 단일 모노레포로 통합 재구현. Supabase는 완전 제거.

## 필독

- `ARCHITECTURE.md` — 모든 설계 결정·스택·이관 순서. 구조에 손대기 전 반드시 읽을 것.
- `docs/CHECKLIST.md` — 실행 체크리스트. 작업 완료 시 체크 상태를 갱신할 것.
- `packages/shared/AGENTS.md` — 디자인 시스템 하네스. admin·store UI 작업 전 반드시 읽을 것.
- `.claude/skills/aside-browser/SKILL.md` — 브라우저 확인 하네스. 브라우저로 UI·플로우를 확인할 때는 반드시 Aside(MCP repl)를 사용할 것.

## 대원칙 (위반 금지)

- 기존 코드 이식 금지 — 전부 새로 작성. 단 기능 명세("무엇을 하는가")는 기존과 동일하게 재현하되, 작업 전 기능·성능·유지보수 관점의 개선점이나 더 적합한 도구가 있으면 실행 전에 제안할 것.
- 스키마는 기존 검토 후 재설계하되 도메인·데이터 의미는 보존. 스키마 변경은 Alembic(`db/`) 경유만 — DDL 직접 실행 금지.
- 프론트에서 supabase-js 금지 — 서버 통신은 `packages/api-client`(OpenAPI 생성물)만 사용.
- api 스펙 변경 시 api-client를 재생성해 함께 커밋 (CI가 드리프트 검사).
- 시크릿 커밋 금지 — GCP는 Secret Manager, 로컬은 `.env`.

## 참고 레포 (읽기 전용, 코드 복사 금지)

- `../git/YeongSeon` — 기능 명세의 원본 (라우트·엣지펑션이 기능 목록).
- `../git/seamless-tile` — 워커의 동작 기준선. 같은 intent+seed → byte-identical SVG 계약과 기존 테스트 50+개를 대조 기준으로 사용.

## 명령어

- 서버 실행 전 반드시 이미 떠 있는지 확인할 것 — 사용자가 보통 store(3000)·api(8000)·worker(8001)·DB를 미리 띄워두고 작업한다. `lsof -i :<port>` 또는 curl로 확인 후, 없을 때만 실행.
- JS: `pnpm lint`(Biome, 레포 전체) · `pnpm turbo build typecheck test` (pnpm workspace + catalogs)
- Python: `uv sync --all-packages` 후 `uv run pytest` · `uv run ruff check .` · `uv run pyright`
- store 로컬 실행: `pnpm --filter store dev`
- admin 로컬 실행: `pnpm --filter admin dev`
- 로컬 DB·스토리지: `docker compose up -d` (Postgres 17 + pgvector localhost:5432, fake-gcs-server localhost:4443) → `uv run alembic -c db/alembic.ini upgrade head` → `uv run python apps/api/scripts/seed.py`
- api 로컬 실행: `uv run uvicorn api.main:app --reload` (시크릿 없으면 Toss/Solapi는 DryRun, GCS는 `.env`의 `GCS_EMULATOR_HOST`로 fake-gcs-server 사용)
- worker 로컬 실행: `uv run uvicorn worker.main:app --port 8001` (api의 `worker_base_url` 기본값과 일치, 로컬은 OIDC 없이 호출)
- **api 스펙 변경 시**: `pnpm codegen` 후 생성물(packages/api-client)을 같은 커밋에 — CI codegen-drift가 검사
- 배포: main 푸시 → `.github/workflows/deploy.yml`이 wrangler(프론트)·Cloud Run(api·worker) 배포. 선행 조건과 인프라 부트스트랩은 `infra/README.md`

## 도메인 규칙

- 인가: 상품·찜/좋아요는 공개 조회, 그 외 리소스는 소유자 본인만, 관리자는 별도 역할. 인가 테스트는 mock 금지 — testcontainers(실제 Postgres)로.
- 결제(Toss)·토큰 과금 로직은 api에만 둔다. 워커는 이미지 생성만.
- id/pw 로그인은 테스트용 — 공개 회원가입 없음, 계정은 시드/관리자로만 생성.

<!-- envide-guard begin -->
## Environment files — do not read

Never read, print, copy, or transmit the contents of `.env` / `.env.*` files (except `*.example`) — they contain secrets. Refer to `.env.example` for key names.
<!-- envide-guard end -->
