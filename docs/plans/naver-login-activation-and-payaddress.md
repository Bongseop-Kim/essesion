# 네이버 로그인 개통 + 네이버페이 배송지 연계 + 네이버앱 자동로그인

네이버 로그인 API 제품군(https://developers.naver.com/products/login/api/api.md) 중 essesion에
적합한 기능을 도입한다. 대상은 세 가지 — ① 네이버 로그인 개통(코드는 완결, 콘솔 등록만 남음),
② 네이버페이 배송지 주소 연계(완전 신규), ③ 네이버앱 자동로그인(auth_type=autologin).
로그인 뱃지는 코드 작업이 없는 콘솔 등록 조건이므로 절차의 체크 항목으로만 둔다.
실행 시점: 네이버 개발자센터 앱 등록·검수가 가능한 운영 준비 단계.

외부 사실 출처 (2026-08-31 확인):

- 배송지 API: https://developers.naver.com/docs/login/payaddress-api/payaddress-api.md —
  `GET https://openapi.naver.com/v1/nid/payaddress`, Bearer access token, 응답은 단일 대표 배송지
  `data.{receiverName, zipCode, baseAddress, detailAddress, roadNameYn, telNo}`. 네이버페이 회원만
  조회 가능, 사용자가 동의하지 않으면 403.
- 자동로그인: 개발가이드 §5.1 — 네이버앱 User-Agent(`NAVER(inapp; search;` 포함) 판별 후
  authorize URL에 `auth_type=autologin`을 붙여 리다이렉트. 실패 시 callback에
  `error=access_denied`(+`error_description`: 미로그인/미연동/비네이버앱)가 온다.
- 뱃지: 개발가이드 §2.2.5 — 앱 등록 시 서비스 URL과 네이버 검색 노출 URL이 동일하면 검색결과에
  자동 노출. 코드 작업 없음.
- 검수: 개발가이드 §3.1.4 — 검수 승인 전에는 등록 개발자 계정만 로그인 가능.

## 왜 필요한가

- 공개 회원가입이 없어 소셜 로그인이 유일한 가입 경로인데
  (`docs/reviews/production-bootstrap-2026-08-15.md`), 4종 중 네이버만 미개통 상태다
  (`ARCHITECTURE.md:280`, `apps/store/src/features/auth/model/providers.ts:27`). 국내 커머스에서
  네이버 계정 커버리지가 가장 넓다(네이버 공식 페이지 기준 4,200만 — 네이버 측 주장 수치).
- 체크아웃 주소 입력은 현재 다음 우편번호 검색 + 수기 입력뿐이다
  (`apps/store/src/features/shipping/ui/address-form-fields.tsx:91-119`). 네이버 로그인 사용자는
  네이버페이 대표 배송지를 자동으로 받아 첫 주문 진입 장벽을 낮출 수 있다.
- 네이버앱 유입(검색·즐겨찾기·톡톡 링크)에서 재방문 시 로그인 과정을 생략할 수 있다.

## 범위 밖 (non-goals)

- 네이버페이 **결제** 연동 — 결제는 Toss 단일 경로 유지(`ARCHITECTURE.md` 대원칙, 돈 경로).
- 네이버 로그인 플러스(약관동의 대행·톡톡 채널 연결) — 톡톡 채널 운영과 약관 등록·검수가 별도로
  필요한 마케팅 기능. 톡톡 운영 결정이 서면 재론.
- 모바일 SDK(Android/iOS/JS) — store는 웹 전용(React Native 앱 없음)이고 서버사이드 OAuth가 이미
  있어 SDK가 하는 일이 없다.
- 개인화 광고 연계 — 제휴 기반 운영 중인 기능으로 신청 대상 아님.

## 실행 조건

- 선행: 네이버 개발자센터 앱 등록 완료 — 서비스 URL은 store 공개 URL, Callback URL은
  `https://api.essesion.shop/auth/naver/callback`(`ARCHITECTURE.md:130` — OAuth callback 외부 등록
  주소는 api.essesion.shop만). 동의 항목에 이름·이메일과 **네이버페이 배송지 정보 조회** API 권한을
  함께 신청한다(권한 미체크 시 403).
- 선행: Secret Manager `naver-client-secret` 주입 + `NAVER_CLIENT_ID` 설정 — 배선은 이미 있음
  (`infra/cloudrun.tf:37`, `apps/api/src/api/config.py:58-59`, `.env.example`).
- **검수 승인 전에는 3·4단계(스토어 개통·배송지 연계)를 프로덕션에 배포하지 않는다** — 검수 전엔
  개발자 계정만 로그인되므로 일반 사용자에겐 깨진 버튼이 된다. 검수가 안 나면 기다린다.
- 배송지 연계(절차 3)는 콘솔에서 배송지 API 권한이 승인된 뒤에만 배포한다. 로그인 개통(절차 2)과
  독립적으로 순차 배포 가능.

## 절차

효과 ÷ 난이도 순. 각 항목은 독립 배포 가능한 크기다.

### 1. 콘솔·인프라 (코드 없음)

1. 네이버 개발자센터 앱 등록:
   - 제공 정보 선택: **회원이름·연락처 이메일 주소만 필수**, 나머지 전부 미선택(필수 과다는 검수
     반려 사유). 휴대전화번호는 자체 휴대폰 인증이 있어 미선택. 검수에서 이메일 필수를 지적받으면
     "추가"로 낮춘다 — `users.email`이 nullable이라 코드 변경 없이 감내된다.
   - 사용 API에 "네이버페이 배송지 정보" 권한 포함.
   - 서비스 환경 "PC 웹": 서비스 URL `https://essesion.shop`(www 없이 — 콘솔 예시 규칙이자 뱃지
     노출 조건), Callback URL `https://api.essesion.shop/auth/naver/callback`. 프론트 착지점
     (`essesion.shop/auth/callback`)을 등록하지 말 것. "모바일 웹" 환경도 같은 서비스 URL로 추가
     (네이버앱 자동로그인 유입은 모바일).
2. 로그인 뱃지: 앱 등록의 서비스 URL을 네이버 검색에 노출되는 사이트 URL과 동일하게 입력한다
   (§2.2.5의 노출 조건). 별도 작업 없음 — 등록 후 검색결과에서 노출 여부만 확인.
3. 시크릿 주입 후 `/readyz`의 `oauth_naver` capability가 true인지 확인
   (`apps/api/src/api/main.py:193-216`).
4. 사전 검수 요청(§3.1.4) — "서비스 적용 형태"는 **"네이버 로그인을 통한 신규 회원 가입에
   적용" 하나만** 체크(공개 회원가입 없이 소셜 로그인이 가입 경로이므로).
   캡처 증빙 확보 순서(검수 전에도 앱은 "개발 중" 상태로 등록 개발자·멤버 계정에 한해 로그인이
   동작한다): ① 앱 등록으로 Client ID/Secret 발급, Callback URL에
   `http://localhost:8000/auth/naver/callback` 추가(최대 5개) → ② 로컬 `.env`에 키 주입 +
   `comingSoon` 제거 작업 트리로 store·api 실행 → ③ 개발자 계정으로
   [로그인 페이지 → 네이버 동의창 → 로그인 완료 화면] 3단계 캡처, 개인정보 마스킹 후 첨부.
   주의: 소셜 가입 과정에 비밀번호 요구가 보이면 검수 거부 — id/pw 이스터에그 폼이 캡처에
   노출되지 않게 할 것.

### 2. 네이버 로그인 스토어 개통

`docs/reviews/pre-deploy-code-gaps-2026-08-14.md` G1이 게이팅과 개통 절차를 이미 결정했다 —
게이팅 구현 자체는 실행 완료된 리뷰이므로 이 플랜에서 제외하고, 남은 개통만 수행한다.

1. `apps/store/src/features/auth/model/providers.ts:27` — `comingSoon` 한 줄 삭제.
2. `apps/store/src/features/auth/model/providers.test.ts:17-23` — "네이버만 준비 중" 고정 테스트를
   4종 전부 개통 상태로 수정.
3. 문서 갱신: `ARCHITECTURE.md:280`("현재 네이버" 문구), `docs/api-spec/domains.md` §2
   (네이버는 scope 파라미터 없이 콘솔 동의 항목으로 제공 정보를 정한다는 사실 추가 —
   현재 kakao/google scope만 기재됨).

### 3. 네이버페이 배송지 연계 (신규)

설계: **네이버 OAuth callback 시점에 1회 가져오기**. callback에서 방금 받은 access token으로
payaddress를 호출해, 사용자의 저장 배송지가 0건일 때만 `shipping_addresses`에 넣는다. 이러면
네이버 토큰을 저장할 필요가 없고(현재 `ensure_oauth_user`는 토큰을 버린다), 가져온 주소는 기존
배송지 선택 UI(`apps/store/src/pages/order/order-form.tsx:261-263`의 첫 배송지 자동 선택,
`address-select-modal.tsx`)에 자연스럽게 나타나므로 **프론트 변경이 0이다**.

1. `apps/api/src/api/domains/auth/oauth.py:166-179` — 네이버 프로필 조회 함수 옆에 payaddress 조회를
   추가한다. `GET v1/nid/payaddress`(api_base가 `openapi.naver.com/`이므로 상대 경로), 403(미동의)·
   404(네이버페이 비회원)·기타 오류는 전부 조용히 None 반환 — 배송지는 부가 기능이라 로그인을
   막으면 안 된다. 실패는 warning 로그만.
2. `apps/api/src/api/domains/auth/router.py:177-203` `_complete_oauth` — provider가 naver이고
   payaddress 조회가 성공했으며 해당 사용자의 배송지가 0건이면 `shipping_addresses`에 1건 생성.
   필드 매핑: receiverName→`recipient_name`, zipCode→`postal_code`,
   baseAddress→`address`, detailAddress→`address_detail`, telNo→`recipient_phone`(하이픈 제거 —
   `apps/api/src/api/domains/users/router.py:44-58`의 normalize validator와 동일 규칙),
   `is_default=True`. `roadNameYn`은 대응 컬럼이 없으므로 버린다. 주의: 컬럼명은
   `address_detail`이다 — 수선 픽업의 `detail_address`(`db/src/db/models/commerce.py:504`)와
   네이밍이 다르니 혼동 금지. **스키마 변경 없음** — Alembic 불필요.
3. "0건일 때만" 가드가 멱등성을 보장한다 — 매 로그인마다 중복 생성되지 않고, 사용자가 지우면
   다음 로그인에서 다시 채워진다(의도된 동작 — 대표 배송지 최신본 재수입).
4. 인가 테스트: testcontainers 기반 auth 테스트에 naver callback 경로의 배송지 생성·0건 가드·
   403 무시 케이스 추가(도메인 규칙 — 인가 테스트 mock 금지). payaddress HTTP 호출 자체는
   Authlib 클라이언트 목킹으로 대체 가능(외부 API라 인가 경계가 아님).
5. 명세 갱신: `docs/api-spec/domains.md` §2에 배송지 연계 동작(시점·0건 가드·실패 무시)을 명기
   (대원칙 — 동작 명세는 api-spec이 정본). 신규 엔드포인트가 없으므로 OpenAPI 스키마는 변하지
   않지만, 변한다면 `pnpm codegen`으로 api-client 재생성을 같은 커밋에.

### 4. 네이버앱 자동로그인 (auth_type=autologin)

설계: 서버는 파라미터 통과만, 판단은 store가 한다.

1. `apps/api/src/api/domains/auth/router.py:166-174` `GET /auth/{provider}/login` — 선택 쿼리
   파라미터 `auth_type`을 받아(값은 `autologin`만 허용) Authlib `authorize_redirect`에 추가
   파라미터로 전달한다. 다른 provider에서는 무시. OpenAPI가 변하므로 `pnpm codegen` 재생성을
   같은 커밋에(대원칙).
2. `apps/api/src/api/domains/auth/router.py:177-203` callback — 네이버가 자동로그인 실패 시
   `error=access_denied`를 callback으로 보낸다(§5.1.5). 현재 callback이 authorize 실패를 어떻게
   처리하는지 확인하고, 오류 시 500이 아니라 `{frontend_origin}/auth/callback?error=...`로 303 하도록
   한다 — store는 오류면 조용히 비로그인 상태로 남는다.
3. store — 세션 부트스트랩(`apps/store/src/features/auth/model/bootstrap-session.ts`) 실패
   (비로그인) 후에: (a) `navigator.userAgent`에 `NAVER(inapp; search;` 포함, (b) 과거 네이버
   로그인 이력 플래그(네이버 OAuth 시작 시 localStorage에 기록 —
   `apps/store/src/pages/auth/login.tsx:97-104` `startOAuth`에서 심는다), (c) 이번 브라우저 세션에서
   미시도(sessionStorage 가드 — 리다이렉트 루프 방지) 세 조건이 모두 참이면
   `/auth/naver/login?auth_type=autologin`으로 이동. 실패 콜백이 돌아오면 sessionStorage 가드가
   재시도를 막는다.
4. 이력 플래그 없이 무조건 시도하는 안은 쓰지 않는다 — 미연동 사용자는 항상 `access_denied`로
   튕겨 첫 방문마다 리다이렉트 왕복 1회를 낭비한다.
5. 명세 갱신: `docs/api-spec/domains.md` §2에 auth_type 파라미터와 오류 리다이렉트 계약 추가.

### 5. 계측

`docs/analytics.md` 규약 확인 후: 자동로그인 성공은 기존 `login` 이벤트
(`apps/store/src/pages/auth/callback.tsx:19-48`)에 method 구분만 추가할 수 있는지 보고, 이벤트
신설은 하지 않는다. 배송지 자동 수입은 서버 로그로 충분 — 이벤트 없음.

## 검증

- 개통: 스테이징에서 네이버 버튼 클릭 → 동의창 → `/auth/callback` 착지 → `GET /auth/me` 200.
  `pnpm --filter store test`로 providers.test.ts 통과.
- 배송지: 네이버페이 대표 배송지가 있는 테스트 계정으로 최초 로그인 후
  `docker compose exec -T db psql -U essesion -d essesion -c "select recipient_name, postal_code, is_default from shipping_addresses"` 로
  1건 생성 확인. 같은 계정 재로그인 → 여전히 1건(0건 가드). 배송지 동의 거부 계정 → 로그인은
  성공하고 배송지 0건.
- 자동로그인: 네이버앱(모바일 실기기)에서 서비스 URL 접근 → 로그인 과정 없이 세션 확립.
  일반 브라우저 → 자동 시도 없음. 미연동 네이버앱 사용자 → 오류 후 일반 로그인 버튼 동작.
- 뱃지: 검수 승인 후 네이버 검색에서 사이트 노출 시 뱃지 확인 (노출 시점은 네이버 재량 —
  미노출이어도 버그 아님).
- `uv run pytest apps/api/tests/<auth 테스트 파일>` + `pnpm lint` + `pnpm architecture:check`
  (문서 링크 추가로 gate 대상).

## 되돌리는 법 / 상향 신호

- 개통 롤백: `providers.ts`에 `comingSoon` 복원 — 서버 코드는 원래부터 있었으므로 프론트 한 줄이
  스위치다.
- 자동로그인 롤백: store의 시도 조건 블록 제거. 서버 auth_type 파라미터는 무해하게 남는다.
- 상향 신호: callback 오류 리다이렉트 급증(자동로그인 루프 의심), 네이버 로그인 사용자의
  배송지 관련 문의(잘못된 대표 배송지 수입) — 후자는 0건 가드 특성상 사용자가 지우고 다시
  로그인하면 재수입되므로, 문의가 반복되면 "재수입 안 함" 플래그로 상향한다.

## 기각한 대안

- **네이버 토큰 저장 + 체크아웃 "네이버 배송지 불러오기" 버튼**: 토큰 저장 테이블·갱신 로직·
  프론트 버튼·신규 엔드포인트가 전부 신규다. callback 1회 수입이 프론트 변경 0으로 같은 가치의
  대부분을 준다. 재론 조건: 사용자가 로그인 이후 시점에 배송지 갱신을 원한다는 실측 신호.
- **JS SDK 도입**: 서버사이드 OAuth가 이미 완결이고 SDK는 implicit/popup 플로우용. 재론 조건 없음.
- **네이버 로그인 플러스**: 범위 밖 참조 — 톡톡 채널 운영 결정이 나면 재론.
- **UA 감지를 서버에서 수행**: store가 정적 배포(Cloudflare Workers Static Assets)라 HTML 응답
  시점에 UA 분기 지점이 없다. 클라이언트 판별이 유일한 자연스러운 위치.
- **payaddress 실패 시 로그인 실패 처리**: 배송지는 부가 기능 — 네이버페이 비회원(404)도 로그인은
  되어야 한다.

**실패 모드 한 줄**: 콘솔 설정(동의 항목·API 권한·검수) 없이 코드만 배포해 403/미노출을 코드
버그로 오진하는 것, 그리고 검수 전 개통으로 일반 사용자에게 깨진 네이버 버튼을 노출하는 것이
이 플랜의 실패 모드다.

**주의(기존 정책, 이 플랜에서 바꾸지 않음)**: 네이버 이메일 신뢰 정책은
`apps/api/src/api/domains/auth/oauth.py:176-178` — `@naver.com` 이메일만 검증 취급이라 외부
이메일의 네이버 계정은 기존 계정에 링크되지 않고 별도 계정이 생긴다. 배송지 연계는 그 별도
계정에 붙는다(정상 동작).
