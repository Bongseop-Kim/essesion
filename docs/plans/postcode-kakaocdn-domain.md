# 우편번호 스크립트 t1.daumcdn.net → t1.kakaocdn.net 이전

스토어 주소 검색(카카오 우편번호 서비스)이 불러오는 스크립트 도메인을 `t1.daumcdn.net`에서 `t1.kakaocdn.net`으로
바꾸고, 스토어 CSP를 함께 고친다. 2026-11-19에 조사했다. **기한은 2026-11-30이다.** 늦어도 그 전에 배포까지
끝나야 한다. 바꿀 곳은 두 파일뿐이라 선행 조건 없이 바로 실행한다.

## 왜 필요한가

- 카카오 공지([kakao-postcode-QnA#1562](https://github.com/kakao-postcode/kakao-postcode-QnA/issues/1562)):
  `t1.daumcdn.net`의 리소스는 2026-11-30(월)까지만 제공하고, 2026-12-01(화)부터는 따로 알리지 않고 끊을 수
  있다. 끊기면 `postcode.v2.js`와 이미지를 불러오지 못한다. 공지는 도메인만 바꾸면 되고 경로와 API 사용법은
  그대로라고 밝힌다.
- 공식 가이드(<https://postcode.map.kakao.com/guide>)도 이미
  `//t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js`를 안내한다.
- 2026-11-19에 두 주소를 직접 받아 보니 둘 다 200으로 응답했고 크기도 35,814바이트로 같았다(VERSION 261109).
  스크립트 안에는 `t1.daumcdn.net`에서 불러왔는지 판별하는 `_legacyCdn_` 플래그가 있다. 옛 도메인으로 불러오면
  팝업 상단에 "t1.daumcdn.net 도메인 종료 안내 - 2026년 11월 30일까지 t1.kakaocdn.net으로 변경해 주세요."라는
  공지가 뜬다. 지금 고객 화면에 이 문구가 보이고 있을 것으로 추정한다(브라우저에서는 확인하지 않았다).
- 레포에서 `daumcdn`을 쓰는 곳은 아래 두 곳뿐이다(2026-11-19 grep 기준). admin `_headers`에는 없다.
  - `apps/store/src/features/shipping/model/use-daum-postcode.ts:25` — 스크립트 URL
  - `apps/store/public/_headers:2` — CSP `script-src https://t1.daumcdn.net`, `img-src https://*.daumcdn.net https://postcode.map.daum.net`

## 범위 밖

- `daum.Postcode` → `kakao.Postcode` 네임스페이스 변경과 훅·타입 이름 변경(`useDaumPostcode` 등). 새 스크립트는
  `window.daum`과 `window.kakao`를 같은 객체로 묶어 두므로 지금 코드가 그대로 돈다(스크립트 첫머리
  `window.daum?window.kakao=window.daum:window.daum=window.kakao`). 공지도 도메인 외 변경을 요구하지 않는다.
- 팝업(`.open()`)을 임베드나 레이어 방식으로 바꾸는 일.

## 실행 조건

- 선행 조건은 없다. 바로 실행한다.
- 2026-11-30 전에 main 배포까지 끝나야 한다. 배포는 main 푸시 → CI 성공 → `deploy.yml` 순서로 진행된다.
- `docs/plans/`에 함께 있는 다른 플랜보다 먼저 실행하고, 다른 변경과 묶지 않고 이 변경만 따로 커밋·배포한다.
  기한이 있는 변경이고, 깨졌을 때 원인을 바로 좁힐 수 있어야 한다.

## 절차

1. `apps/store/src/features/shipping/model/use-daum-postcode.ts:25` — URL의 호스트를 `t1.daumcdn.net`에서
   `t1.kakaocdn.net`으로 바꾼다. 경로는 그대로 둔다. 근거: 공지 #1562와 공식 가이드.
2. `apps/store/public/_headers:2` — CSP를 고친다.
   - `script-src`: `https://t1.daumcdn.net`을 `https://t1.kakaocdn.net`으로 바꾼다. 이걸 빠뜨리면 1번이 CSP에 막혀
     주소 검색이 바로 깨진다. 이 플랜에서 가장 쉽게 놓치는 부분이다.
   - `img-src`: `https://*.daumcdn.net`을 `https://t1.kakaocdn.net`으로 바꾼다. 공지 #1562의 "변경 대상" 표가 이미지
     리소스 주소를 `t1.kakaocdn.net/postcode/resource/images/...`로 안내한다. 다만 스크립트(VERSION 261109) 안에는
     이미지 URL이 없어, 우리 페이지에서 실제로 이 이미지를 불러오는지는 확인하지 못했다(추정). CSP는 배포 뒤에만
     확인할 수 있으므로 방어적으로 넣어 둔다. 함께 있는 `https://postcode.map.daum.net`도 지운다. 새 스크립트에는
     이 호스트를 가리키는 곳이 없고 `postcode.map.kakao.com`만 쓴다.
   - `frame-src https://postcode.map.kakao.com`은 그대로 둔다.
3. 레포 전체를 grep해서 `daumcdn`과 `postcode.map.daum.net`이 하나도 남지 않았는지 확인한다.

## 검증

- `pnpm lint && pnpm --filter store typecheck`
- 로컬 스토어(:3000)에서 배송지 폼의 주소 검색을 연다. 네트워크 탭에 `t1.kakaocdn.net/.../postcode.v2.js`가 200으로
  보이고, 팝업에 종료 안내 공지가 뜨지 않으며, 주소를 고르면 우편번호와 주소 칸이 채워지는지 본다. 이 확인은
  사용자가 띄워 둔 서버에서 한다.
- 로컬 dev 서버는 `_headers`를 적용하지 않으므로 CSP는 배포 뒤에 확인해야 한다. 프로덕션 스토어에서 같은 동작을
  해 보고 콘솔에 CSP 위반(`Refused to load`)이 없는지 본다. `curl -sI https://<스토어 도메인>/ | grep -i content-security`로
  `t1.kakaocdn.net`이 들어갔는지도 확인한다.

## 되돌리는 법

- 배포 뒤 주소 검색이 깨지면 1·2번 커밋을 revert한다. 단, 이 방법은 2026-11-30까지만 쓸 수 있다. 그 뒤에는 옛
  도메인이 사라져 되돌릴 곳이 없으므로, 원인(대개 CSP 누락)을 찾아 앞으로 고쳐 나간다.

## 기각한 대안

- **스크립트를 직접 호스팅(self-host)**: 카카오가 스크립트를 바꿔 가며 배포하고(VERSION 표기) 팝업 도메인과도
  짝이 맞아야 하므로, 사본을 두면 언젠가 어긋난다. 카카오가 버전 고정 배포를 제공하면 다시 검토한다.
- **`react-daum-postcode` 같은 래퍼 도입**: 지금 훅은 63줄이고 동작에 문제가 없다. 도메인 하나 바꾸자고 의존성을
  늘릴 이유가 없다.

실패 모드: 스크립트 URL만 바꾸고 CSP `script-src`를 놓쳐, 로컬에서는 되는데 프로덕션에서만 주소 검색이 깨지는
경우다.
