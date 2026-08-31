# Apple 로그인 콜백 500 수정 — 실행 기록 (2026-08-31)

플랜: `docs/plans/fix-apple-login-callback.md` (실행 완료로 제거).
증상은 "Apple 로그인 시 api 콜백 URL로 이동되면서 알 수 없는 문자열이 뜨고 로그인 실패".

## 원인 (코드로 확정, 추정 아님)

`python-multipart` 의존성 누락. 체인:

1. Apple만 `response_mode=form_post`로 등록돼(`auth/oauth.py:build_oauth`) 콜백이 **POST form**으로
   온다. google·kakao·naver는 GET + query라 form 파싱 경로를 타지 않는다 — Apple만 실패한 이유.
2. authlib가 POST 콜백에서 `request.form()`을 호출하고, Starlette는 **content-type과 무관하게**
   form 파싱에 `python-multipart`를 요구한다(`starlette/requests.py`의 assert — urlencoded도 필수).
3. `apps/api/pyproject.toml`·`uv.lock`·프로덕션 이미지(`Dockerfile`의 `uv sync --no-dev`) 어디에도
   그 패키지가 없었다. plain `fastapi`라 extra로도 들어오지 않는다.
4. → `AssertionError` → catch-all(`api/errors.py`)이 `{"detail":"서버 오류가 발생했습니다",
   "code":"internal_error"}` 500 JSON을 **브라우저 최상위 내비게이션 종착지인 API URL에** 렌더.

기존 테스트가 못 잡은 이유: `test_auth.py`의 `_FormRequest` 스텁이 자체 `form()`을 제공해 실제
Starlette 파서를 우회했고, `POST /auth/apple/callback`에 실요청을 보내는 테스트가 0건이었다.
`pre-deploy-code-gaps-2026-08-14.md`의 "Apple 구현 완결" 판정도 이 의존성을 놓쳤다.

## 변경

| 항목 | 위치 |
|---|---|
| `python-multipart>=0.0.20` 추가 (`uv lock` → 0.0.32) — **핵심 수정** | `apps/api/pyproject.toml` |
| 콜백 실패를 전부 프론트 303으로. 사유를 3코드로 구분 | `auth/router.py:_complete_oauth` |
| Apple 취소(form의 `error`)를 토큰 교환 전에 차단 | `auth/router.py:apple_oauth_callback` |
| 코드별 문구 매핑 | `store/pages/auth/callback.tsx` |
| 콜백 실패 계약 명문화 | `docs/api-spec/domains.md` §2 |

실패 코드 3종 — 플랜에는 "어떤 실패든 리다이렉트"만 있었으나, 전부 `access_denied`로 뭉치면
비활성·비고객 계정 거부에도 "로그인이 취소되었습니다"라고 거짓 안내가 나가서 갈랐다:

- `access_denied` — provider 단계(동의 취소·자동로그인 실패·토큰 교환 실패)
- `account_unavailable` — 계정 단계(`ensure_oauth_user`의 비활성·비고객 거부)
- `server_error` — 그 외 전부. 상세는 `logger.exception`으로 서버 로그에만.

의존성만 고쳤을 때 남는 구조적 노출(예: id_token 파싱 실패 시 `oauth.py`의 `KeyError: 'sub'`,
`missing_configuration` 503)도 이 리다이렉트가 함께 덮는다.

## 검증 (통과)

- `uv run pytest apps/api/tests/test_auth.py` — 97 passed. 신규 4건:
  실제 form 파서를 타는 `POST /auth/apple/callback` 성공(이름은 최초 인가 form의 `user`에서),
  취소 form → 토큰 교환 없이 `access_denied`, 예상 못 한 예외 → `server_error`,
  비고객 계정 → `account_unavailable`.
- **회귀 가드 실증**: `starlette.requests.parse_options_header = None`으로 multipart 부재를 흉내
  내고 돌리면 신규 테스트가 프로덕션과 같은 `AssertionError: The python-multipart library must be
  installed...`로 실패하고, 기존 `_FormRequest` 스텁 테스트는 그대로 통과했다 —
  사각지대가 실제로 닫혔음을 확인.
- `uv run ruff check apps/api`, `uv run pyright`, `pnpm lint`, `pnpm typecheck` 클린.
- codegen 불필요 — OAuth 라우트는 `include_in_schema=False`.

## 잔여 (실서비스 실측 — 배포 후)

로컬은 HTTP라 Apple 실 OAuth를 돌릴 수 없다(`main.py` 주석).

1. Apple 개발자 콘솔 Return URL이 `https://api.essesion.shop/auth/apple/callback`과 일치하는지 확인.
2. 배포 후 Apple 로그인 1회 — 성공, 취소 시 `/auth/callback?error=access_denied` 도착,
   어떤 경우에도 API URL에 JSON이 뜨지 않음.

## 기각한 대안

- `fastapi[standard]`로 교체 — 불필요한 extra 동반. 필요한 패키지 하나만 추가.
- Apple을 GET 콜백으로 전환 — `name`/`email` scope가 form_post를 강제하고
  `ARCHITECTURE.md`가 이미 그 전제로 SessionMiddleware를 `SameSite=None`으로 잡고 있다.
