# 배포 전 코드 결함 3건 — 처리 결과 (2026-08-14)

문서 전면 재작성 중 코드 대조로 발견한, 문서 수정으로 해결되지 않는 항목의 실행 기록.
플랜: `docs/plans/pre-deploy-code-gaps.md` (실행 완료로 제거).

## G1. 미개통 provider 버튼 게이팅 — 완료

**결정**: 네이버는 이후 일정이므로 store에서 게이팅하고, Apple은 그대로 노출한다.

Apple 구현을 코드로 확인한 결과 **완전하다** — 콘솔 등록만 남았다.

| 항목 | 위치 |
|---|---|
| `.p8` 키로 서명한 ES256 client_secret JWT (180일 TTL, 프로세스 기동 시 1회) | `oauth.py:_apple_client_secret` |
| OIDC discovery + `response_mode=form_post` | `oauth.py:build_oauth` |
| 크로스사이트 POST 콜백 라우트 | `auth/router.py` `POST /auth/apple/callback` |
| POST 콜백용 `SameSite=None` 세션 쿠키 (local/test는 Lax) | `main.py` SessionMiddleware |
| 최초 인가에만 오는 `user` 폼 필드에서 한국식 성+이름 결합 | `oauth.py:_apple_name_from_form_user` |
| `email_verified`를 bool·`"true"` 양쪽 수용 | `oauth.py:fetch_profile` |
| capability는 client_id·team_id·key_id·private_key 4개가 다 있을 때만 `ready` | `main.py` `oauth_apple` |
| 테스트 | `test_auth.py` — ES256 JWT 유효성, verified 클레임 2종, 이름 파싱 |

**변경**: `AUTH_PROVIDERS[].comingSoon`(안내 문구, optional)을 추가하고 네이버에만 채웠다.
`login.tsx`가 이 값이 있으면 OAuth로 보내지 않고 `snackbar`로 안내한다. 버튼은 그대로 두어
disabled 버튼의 "왜 안 되는지 모름" 문제를 피했다.

새 환경변수를 만들지 않았다 — 열 때는 콘솔 등록 + `naver-client-*` 시크릿 주입 후
`providers.ts`의 `comingSoon` 한 줄을 지우면 된다.

검증: `providers.test.ts` — 4종 전부 노출 + 게이팅 대상이 네이버뿐임을 고정.

## G2. `VITE_GA_MEASUREMENT_ID` — 코드 변경 없음

배선은 이미 완결이다: `main.tsx`가 `initAnalytics()`를 부르고, 측정 ID가 없으면 모듈 전체가
no-op이며(`analytics.ts`), `deploy.yml`이 `vars.VITE_GA_MEASUREMENT_ID`를 빌드에 넘긴다.
store에는 script-src를 제한하는 CSP가 없어 gtag.js 동적 로드도 막히지 않는다.

따라서 남은 건 **GitHub 변수 설정뿐**이며, `infra/README.md`의 `gh variable set` 블록과
`OPERATOR-CHECKLIST` A6에 추가했다. 빌드 경고는 추가하지 않았다 — GA는 배포를 막을 만한
필수 기능이 아니다.

## G3. `scheduler.tf` 주석 — 완료

"정리 배치 4종" → "배치 5종"(`authoring-promotion-candidates` 포함).

## 문서 동기화

`ARCHITECTURE.md` §4.1·§8.2, `docs/CHECKLIST.md` §4, `docs/OPERATOR-CHECKLIST.md` B5·E2,
`README.md`를 네이버 게이팅 결정에 맞췄다. 같은 대조에서 README에 남아 있던 폐기 개념
("SVG 후보 1~4개", "후보 선택")도 재설계 1단계 결과(생성 1회 = 디자인 1개)로 정정했다.
