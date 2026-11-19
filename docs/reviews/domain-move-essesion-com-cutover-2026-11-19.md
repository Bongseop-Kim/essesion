# essesion.com 이전 — 토스 변경·전환 결과 (2026-11-19)

`docs/plans/domain-move-essesion-com.md`의 C(토스 변경 신청)와 D(전환)의 1~4번을 실행했다. 정본 주소는
이제 `essesion.com`이고 `.shop`은 302로 넘어온다. 남은 일(실측·콘솔 변경·301 전환·정리)은 플랜에 있다.

## 한 일

- **토스**: 홈페이지 주소 변경이 승인됐고 `.com`에서 실결제 1건이 성공했다(운영자 확인).
- **전환 PR #112 머지**: main에 맞추면서 `apps/store/public/_headers`(main의 최신 CSP 기준으로 `api.essesion.shop`만
  제거)와 `apps/store/src/pages/home/index.tsx`의 충돌을 풀었다. GitHub Actions 변수 `VITE_API_BASE_URL`을
  `https://api.essesion.com`으로 바꾼 직후 머지했다.
- **DB 주소 마이그레이션**: 배포의 backend job에서 `8c2f5a1d7e93`이 적용됐다. 상품 목록 API의 이미지 주소가
  전부 `assets.essesion.com`이다.
- **구 존 리다이렉트**: 배포가 `essesion.shop`·`app.`·`admin.`의 Worker 레코드를 지웠다. 세 이름에 프록시된
  `AAAA 100::`을 만들고 Single Redirect 4개를 켰다(기존 www→루트 규칙은 껐다). 302·경로·쿼리 보존을 curl로
  확인했다. `api.`·`assets.`는 그대로 200이다.
- **운영 값**: `production.tfvars`의 `public_api_origin`·`FRONTEND_ORIGIN`·`ADMIN_FRONTEND_ORIGIN`·
  `PUBLIC_ASSETS_ORIGIN`을 `.com`으로, `ALT_SITE_ORIGINS`를 `.shop` 쌍으로 바꾸고, `CORS_ORIGINS`와 업로드
  CORS에 `https://admin.essesion.com`을 추가해 apply했다. 버킷의 tfvars도 갱신했다.
- **알림톡**: `[com]` 템플릿 8종이 모두 "발송에 사용가능"인 것을 솔라피 콘솔에서 확인하고
  `SOLAPI_TEMPLATE_*` 8개를 새 ID로 넣었다(4종 교체, 4종 추가). ID는 `alimtalk-com-migration-2026-11-12.md`의 표와 같다.
- **가동 감시**: 대상이 `api.essesion.com`으로 바뀌었다(#120).
- **토스 웹훅**: `https://api.essesion.com/payments/webhook`을 `PAYMENT_STATUS_CHANGED`로 등록했다.

## 확인한 것

- `api.essesion.com/readyz` ready. `admin.essesion.com`·`essesion.com`·`essesion.shop` 출처 모두 CORS 허용.
- 카카오·네이버·구글 로그인의 `redirect_uri`가 `api.essesion.com`. `api.essesion.shop`으로 들어오면 `.shop` 쌍.
- 검색 정본·og:image가 `essesion.com`.
- apply 후 다시 plan을 돌려 차이 없음.

## 플랜과 달랐던 점

- **토스 웹훅은 등록된 적이 없었다.** 플랜은 `.shop` 웹훅이 있다고 전제하고 "추가 등록 후 구 웹훅 삭제"로
  적었지만 개발자센터 목록이 비어 있었다. 엔드포인트는 2026-07-06부터 코드에 있었으나 운영에서 통지를 받은
  적이 없다 — 이번 등록이 첫 개통이고, 지울 구 웹훅은 없다.
- **마이그레이션 헤드가 둘이 됐다.** #112를 만든 뒤 main에 `9a4c7e1d5b20`이 같은 부모로 들어와 있었다.
  `8c2f5a1d7e93`의 부모를 `9a4c7e1d5b20`으로 옮겼다. 오래 열어 둔 PR에 마이그레이션이 있으면 머지 전에 헤드를
  다시 본다.
- **`CORS_ORIGINS`에 `admin.essesion.com`이 빠져 있었다.** 플랜은 업로드 CORS만 언급했다. 넣지 않으면 새 admin의
  api 호출이 전부 막힌다.
- **가동 감시 교체가 apply에서 실패했다.** 알림 정책이 기존 감시 항목을 참조해 먼저 지울 수 없었다
  (400 `please ensure all associated Alert Policies are deleted`). `create_before_destroy`를 넣어 해결했다(#120).
  이 실패 전에 api·버킷 변경은 이미 적용된 상태였다.
- **tofu 인증**: 이 머신의 기본 자격 증명(ADC)으로는 상태 버킷이 403이었다. gcloud 로그인 계정의 토큰을
  `GOOGLE_OAUTH_ACCESS_TOKEN`으로 넘겨 실행했다.
- **`SOLAPI_TEMPLATE_SHIPPING_STARTED`는 운영에 설정된 적이 없었다.** 배송 시작 알림은 지금까지 건너뛰고
  있었고 이번에 처음 켜졌다.

## 확인하지 못한 것

- 운영 DB에 `essesion.shop` 문자열이 남은 행 수(D-5). API 응답의 상품 이미지만 봤다.
- 2026-11-12~19 사이 클레임 완료·거부 알림톡 — 새 코드(변수 2개)가 옛 템플릿으로 보냈다. 실패 여부는 솔라피
  발송 내역에서 본다.
- 토스 웹훅의 실제 수신. 로컬에서 빈 POST에 200이 오는 것만 확인했다.
- 전환 뒤 브라우저 실측(로그인·결제·업로드·알림톡 링크·admin).
