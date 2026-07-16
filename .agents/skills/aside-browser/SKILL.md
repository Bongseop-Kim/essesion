---
name: aside-browser
description: 브라우저에서 UI·플로우를 확인/검증할 때 사용하는 하네스. Aside MCP repl(Playwright)로 페이지를 열고 snapshot·스크린샷으로 확인한다. "브라우저로 확인", "화면 확인", "직접 눌러봐", 스크린샷 요청, /verify·/run에서 웹 UI를 구동해야 할 때 사용.
---

# aside-browser

브라우저 확인은 항상 **Aside**를 사용한다. 다른 브라우저 자동화 도구를 대신 쓰지 않는다.

- 문서 인덱스: https://docs.aside.com/llms.txt
- CLI·MCP·REPL: https://docs.aside.com/help/developers

문서 확인이 필요하면 반드시 인덱스를 먼저 읽고 관련 페이지만 연다.

## 도구 선택

| 목적 | 도구 |
| --- | --- |
| 직접 페이지 검사, locator 조작, snapshot, 스크린샷, 다운로드 | `mcp__aside__repl` |
| MCP가 아직 로드되지 않은 세션에서 결정적 단일 작업 | `aside repl '<javascript>'` |
| 자연어로 긴 브라우저 작업 위임 | `aside '<task>'` |

검증의 기본은 Playwright API가 노출된 영속 JS REPL인 `mcp__aside__repl`이다. CLI 작업이 세션 ID를 반환하면 후속 작업은 `aside --session <session-id> '<task>'`로 이어간다.

## 로컬 대상

| 앱 | URL | 실행 |
| --- | --- | --- |
| store | http://localhost:3000 (strictPort) | `pnpm --filter store dev` |
| admin | http://localhost:3001 (strictPort) | `pnpm --filter admin dev` |
| api | http://localhost:8000 | `uv run uvicorn api.main:app --reload` |

api 없이 프론트만 띄우면 데이터 호출이 실패하므로, 플로우 검증 시 api(+DB: `docker compose up -d` → alembic → seed)를 먼저 확인한다. 시크릿 없으면 Toss/Solapi/GCS는 DryRun이므로 결제 플로우도 로컬에서 끝까지 진행 가능하다.

## 시드 계정 (id/pw 로그인은 테스트 전용)

- 관리자: `admin@local` / `admin-local-password` (또는 `SEED_ADMIN_PASSWORD`)
- 고객: `customer@local` / `customer-local-password`

## 사용 패턴

1. `aside account list`로 선택된 계정이 로그인 상태인지 확인한다. 여러 계정이면 `--account <id>`로 이번 실행만 명시한다.
2. dev 서버가 이미 떠 있는지 먼저 확인(`curl -sf localhost:3000`)하고, 없으면 백그라운드로 띄운다.
3. `openTab(url)`로 페이지를 열고, 페이지 읽기는 **`snapshot(page)`가 기본** — 텍스트·구조 확인에 스크린샷보다 싸고 정확하다.
4. 시각적 확인(레이아웃·스타일)이 필요할 때만 `display(await page.screenshot())`.
5. 클릭·입력 등 상호작용은 Playwright locator API(`page.getByRole(...)`, `locator.click()` 등)를 그대로 사용한다.
6. REPL 스코프는 호출 간 유지된다 — `const` 변수명을 재사용하면 에러가 나므로 매 호출 새 이름을 쓴다.
7. 탭을 연 직후 콘솔·페이지 오류 리스너를 연결하고, 검증 마지막에 수집된 오류를 확인한다.
8. 결과에는 확인한 URL·viewport·주요 동작·콘솔 오류 유무를 남긴다.

## 연결 확인과 복구

```bash
aside --version
aside account list
codex mcp list
```

- `aside` MCP가 없으면 `codex mcp add aside -- aside mcp`로 등록하고 에이전트 세션을 다시 시작한다.
- 계정이 signed out이면 Aside **Settings > Account**에서 다시 로그인하거나 `aside account use <id>`로 로그인된 계정을 선택한다.
- 프로젝트 MCP 설정은 루트 `.mcp.json`이 소유한다.

## 금지

- 브라우저 확인 목적으로 Playwright/Puppeteer를 새로 설치하거나 별도 스크립트를 프로젝트에 추가하지 않는다 — aside repl로 충분하다.
- 프로덕션 URL에 대해 쓰기 동작(주문·결제·삭제)을 수행하지 않는다. 상호작용 검증은 로컬에서만.
- 비밀번호·토큰·결제정보를 snapshot, 스크린샷, 로그에 노출하지 않는다.
