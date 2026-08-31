# 네이버 로그인 개통 + 네이버페이 배송지 연계 + 네이버앱 자동로그인 — 실행 기록 (2026-08-31)

플랜: `docs/plans/naver-login-activation-and-payaddress.md` (실행 완료로 제거).
코드·문서·자동화 테스트는 완료. **콘솔 검수 승인 대기 중이라 실서비스 검증(실기기 자동로그인,
실계정 배송지 수입)은 미완** — 잔여 체크리스트가 이 문서 마지막에 있다.

## 1. 네이버 로그인 개통 — 완료 (코드는 원래 완결, 스위치만 제거)

- `apps/store/src/features/auth/model/providers.ts` — 네이버 `comingSoon` 게이팅 제거
  (`pre-deploy-code-gaps-2026-08-14.md` G1이 예고한 개통 절차 그대로).
- `providers.test.ts` — "네이버만 준비 중" 고정을 "전 provider 게이팅 없음"으로 교체.
- 콘솔 등록 완료(2026-08-31): 제공 정보는 회원이름·이메일만 필수, 사용 API에 네이버페이 배송지
  정보 포함, 서비스 URL `https://essesion.shop`(뱃지 노출 조건), Callback
  `https://api.essesion.shop/auth/naver/callback` + 로컬 `http://localhost:8000/auth/naver/callback`.
  검수 요청 제출됨 — 서비스 적용 형태는 "신규 회원 가입에 적용" 단독.
- 로그인 뱃지는 코드 없음 — 서비스 URL이 검색 노출 URL과 동일하면 자동 노출.

## 2. 네이버페이 배송지 연계 — 완료 (신규, 프론트 변경 0)

설계: 네이버 OAuth callback에서 방금 받은 access token으로 `v1/nid/payaddress`를 1회 조회,
**저장 배송지 0건인 사용자에게만** 기본 배송지로 수입. 네이버 토큰은 저장하지 않고, 수입된
주소는 기존 배송지 선택 UI에 자연히 나타난다.

| 항목 | 위치 |
|---|---|
| `NaverPayAddress` 타입 + `OAuthProfile.payaddress` 필드 | `oauth.py` |
| 배송지 조회 — 미동의(403)·비회원(404)·네트워크 오류 전부 None (로그인 불차단) | `oauth.py:_fetch_naver_payaddress` |
| 0건 가드 수입 + `telNo` 휴대폰 정규화(유선번호는 건너뜀) + DB 오류 rollback | `service.py:import_naver_payaddress` |
| callback 연결 | `auth/router.py:_complete_oauth` |
| 스키마 변경 없음 (`shipping_addresses` 그대로, Alembic 불필요) | — |

필드 매핑: receiverName→recipient_name, zipCode→postal_code, baseAddress→address,
detailAddress→address_detail, telNo→recipient_phone. `roadNameYn`은 대응 컬럼 없어 버림.

0건 가드가 멱등성 담당 — 사용자가 지우면 다음 로그인에서 재수입(의도된 동작). 관련 문의가
반복되면 "재수입 안 함" 플래그로 상향(플랜의 상향 신호).

## 3. 네이버앱 자동로그인 — 완료

서버는 파라미터 통과만, 시도 판단은 store가 한다.

| 항목 | 위치 |
|---|---|
| `GET /auth/naver/login?auth_type=autologin` (네이버 전용, 타 provider 무시) | `auth/router.py:oauth_login` |
| provider 오류 콜백을 JSON 401 대신 `…/auth/callback?error=access_denied` 303으로 — 수동 취소 UX도 함께 개선 | `auth/router.py:_complete_oauth` |
| 시도 조건 3종: 네이버앱 UA(`NAVER(inapp; search;`) + 과거 네이버 로그인 이력(localStorage) + 브라우저 세션당 1회(sessionStorage) | `features/auth/model/naver-autologin.ts` |
| 이력 마킹(네이버 OAuth 시작 시) | `pages/auth/login.tsx:startOAuth` |
| 비로그인 부트스트랩 후 1회 시도 | `app/providers/auth-provider.tsx` |
| 오류 콜백 처리 — 자동로그인 실패는 조용히 홈, 수동 취소는 안내 후 로그인 페이지 | `pages/auth/callback.tsx` |

이력 플래그 없이 무조건 시도하는 안은 기각 — 미연동 방문자가 매번 access_denied 왕복을 낭비한다.

## 검증 (자동화 — 통과)

- api: `uv run pytest apps/api/tests/test_auth.py` 93 passed — payaddress 파싱 3케이스(성공·
  미동의/에러 응답·필드 누락), 수입 DB 테스트 3건(0건 수입·기존 배송지 불변·유선번호 건너뜀,
  testcontainers 실 PG), 타 provider 미조회.
- store: `pnpm --filter store test` 243 passed — 자동로그인 조건·소진 4케이스 신규.
  jsdom 한계로 실제 리다이렉트(성공 경로)는 단위 테스트 미포함.
- `uv run ruff check .`, `uv run pyright`(auth 도메인), `pnpm lint`, `pnpm architecture:check` 클린.
- codegen 불필요 — OAuth 라우트는 `include_in_schema=False`라 OpenAPI 불변.

## 문서 동기화

- `docs/api-spec/domains.md` §2 — 네이버 scope 없음(콘솔 동의 항목), 배송지 연계 계약(시점·
  0건 가드·실패 무시·토큰 미저장), autologin 파라미터·오류 리다이렉트 계약.
- `ARCHITECTURE.md` §4.1 — "현재 네이버" 게이팅 문구 → 4종 개통, 네이버 부가 기능 2종 추가.

## 잔여 (미검증 — 검수 승인 후 순서대로)

1. **검수 승인 전 main 머지 금지** — 머지가 곧 배포이고, 검수 전엔 개발자 계정만 로그인돼
   일반 사용자에게 깨진 네이버 버튼이 노출된다.
2. 검수 승인 시 네이버페이 배송지 API 권한이 함께 승인됐는지 콘솔에서 확인.
3. 머지·배포 후 실측: `/readyz`의 `oauth_naver` → 네이버페이 실계정 최초 로그인 후
   `select recipient_name, postal_code, is_default from shipping_addresses` 1건 확인, 재로그인
   시 여전히 1건(0건 가드), 동의 거부 계정은 로그인 성공 + 배송지 0건.
4. 네이버앱 실기기: 연동 이력 있는 기기에서 재방문 시 무로그인 세션 확립, 일반 브라우저는
   자동 시도 없음, 미연동 사용자는 오류 후 일반 로그인 버튼 정상.
5. 네이버 검색에서 로그인 뱃지 노출 확인 (노출 시점은 네이버 재량 — 미노출이어도 버그 아님).
