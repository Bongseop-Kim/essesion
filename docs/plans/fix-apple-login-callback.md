# Apple 로그인 콜백 500 수정 (python-multipart 누락)

Apple 로그인 시 API 콜백 URL(`/auth/apple/callback`)에서 JSON 에러 본문이 화면에 그대로
표시되고 로그인이 실패하는 버그를 고친다. 2026-08-31 조사 기준. feat/naver 워킹트리의
auth 변경(`router.py`의 `?error=access_denied` 리다이렉트 등)이 커밋된 위에서 실행한다 —
그 변경을 되돌리면 이 플랜의 항목 2 전제가 달라진다.

## 왜 필요한가

원인 체인 (코드로 확인, 추정 아님):

1. Apple만 `response_mode=form_post`로 등록돼(`apps/api/src/api/domains/auth/oauth.py:106-117`)
   콜백이 **POST form**으로 온다. 다른 3종(google/kakao/naver)은 GET + query라 form 파싱을
   안 탄다 — Apple만 실패하는 이유.
2. authlib는 POST 콜백에서 `request.form()`을 호출하고, Starlette는 content-type과 무관하게
   form 파싱에 `python-multipart`를 요구한다(starlette `requests.py`의 assert — urlencoded여도
   필수). 출처: starlette 소스 확인, 2026-08-31.
3. `python-multipart`가 `apps/api/pyproject.toml` 의존성·`uv.lock`·프로덕션 이미지
   (`Dockerfile:19`의 `--no-dev` sync) 어디에도 없다. plain `fastapi`라 extra로도 안 들어온다.
4. → `AssertionError` → catch-all(`apps/api/src/api/errors.py:149-170`)이
   `{"detail":"서버 오류가 발생했습니다","code":"internal_error"}` 500 JSON을 브라우저
   최상위 내비게이션 종착지인 API URL에 렌더 = "알 수 없는 문자열".

테스트가 못 잡은 이유: `apps/api/tests/test_auth.py:1065-1070`의 `_FormRequest` 스텁이 자체
`form()`을 제공해 실제 Starlette 파서를 우회하고, `POST /auth/apple/callback`에 실요청을
보내는 테스트가 레포에 0건이다. `docs/reviews/pre-deploy-code-gaps-2026-08-14.md:10`의
"Apple 구현 완전" 판정도 이 의존성을 놓쳤다.

## 범위 밖 (non-goals)

- 네이버 자동로그인·payaddress 플로우(같은 브랜치 워킹트리 작업)는 건드리지 않는다.
- 프론트(`apps/store/src/pages/auth/*`)는 수정하지 않는다 — 프론트는 프로바이더 무관하게
  API가 refresh 쿠키를 심고 303으로 돌려보내는 것만 기대하며, 실패는 그 전 단계에서 난다.

## 실행 조건

- 로컬에서 Apple 실 OAuth는 검증 불가(`apps/api/src/api/main.py:274-276` 주석: HTTPS 필요).
  검증 항목의 form-POST 테스트와 스테이징/프로덕션 실측으로 대신한다.
- Apple 개발자 콘솔의 Return URL이 `{public_api_origin}/auth/apple/callback`과 일치하는지
  별도 확인(불일치면 Apple 쪽 페이지에 에러가 뜨는 다른 증상이므로 이 플랜 밖이지만,
  배포 후 실측 전에 확인해 둔다).

## 절차

1. **의존성 추가 (핵심 수정)** — `apps/api/pyproject.toml` dependencies에
   `python-multipart>=0.0.20` 추가 후 `uv lock` + `uv sync --all-packages`.
   근거: 위 원인 체인 2–3.
2. **콜백 예외를 전부 프론트로 리다이렉트** — `apps/api/src/api/domains/auth/router.py:189-196`의
   `except UnauthorizedError`를 `except Exception`(로깅 포함)으로 넓혀, 어떤 실패든
   `{frontend_origin}/auth/callback?error=...`로 303 보낸다. 근거: 콜백은 브라우저 최상위
   내비게이션 종착지라 JSON을 반환하는 순간 사용자 화면에 raw 문자열이 뜬다 — multipart를
   고쳐도 이 구조적 노출(예: id_token 파싱 실패 시 `oauth.py:211`의 `KeyError: 'sub'`)은 남는다.
3. **Apple 취소 플로우 처리** — authlib의 POST 분기는 GET 분기와 달리 form의 `error`를
   검사하지 않으므로(authlib `apps.py` 확인), `apps/api/src/api/domains/auth/router.py:224-228`의
   apple 콜백에서 form의 `error`(예: `user_cancelled_authorize`)를 먼저 확인해
   `?error=access_denied`로 리다이렉트한다. 네이버/카카오 취소와 동일한 UX가 된다.
4. **실제 form 파싱을 타는 테스트 추가** — `apps/api/tests/test_auth.py`에
   `POST /auth/apple/callback`으로 urlencoded body를 실제 전송하는 테스트를 추가한다
   (토큰 교환은 mock하되 Starlette form 파서는 실경로로). 취소 form(`error=user_cancelled_authorize`)
   → 303 리다이렉트 케이스도 1건. 근거: `_FormRequest` 스텁이 이 버그를 가렸다.
5. **명세 보강** — `docs/api-spec/domains.md:23`의 Apple 항목에 "콜백 실패는 JSON이 아니라
   `{frontend_origin}/auth/callback?error=...` 303으로 종결한다"를 명시한다(항목 2가 계약이
   되도록, 대원칙).

## 검증

- `uv run pytest apps/api/tests/test_auth.py`
- `uv run python -c "import multipart"` 성격의 확인 대신:
  `uv run python -c "from starlette.formparsers import parse_options_header; assert parse_options_header"`
- 배포 후 실측: 스테이징/프로덕션에서 Apple 로그인 1회 — 로그인 성공, 취소 시
  `/auth/callback?error=access_denied` 도착, 어떤 경우에도 API URL에 JSON이 뜨지 않음.
- 실측 시 화면 문자열 재확인: 수정 전 증상이 401 `unauthorized`였다면 HEAD(리다이렉트 없던
  배포본) 원인, 500 `internal_error`였다면 multipart 원인 — 어느 쪽이든 본 플랜이 둘 다 덮는다.

## 기각한 대안

- **`fastapi[standard]`로 교체** — python-multipart 외에 불필요한 extra(uvicorn 재중복 등)가
  딸려온다. 필요한 패키지 하나만 추가. 재론 조건: standard extra의 다른 구성요소가 필요해질 때.
- **Apple을 GET 콜백으로 전환(`response_mode` 제거)** — Apple은 `name`/`email` scope 요청 시
  form_post를 강제한다(Apple 문서 확인 필요 사항이지만 현 구현·ARCHITECTURE.md:279가 이미
  form_post 전제). 전환은 scope 축소를 동반해 더 큰 변경. 기각.

이 플랜의 실패 모드: 로컬에서 Apple 실 OAuth를 검증할 수 없다는 이유로 form-POST 테스트를
mock 스텁으로 다시 작성해 같은 사각지대를 재생산하는 것.
