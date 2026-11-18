# 스토어 하단 고정 바 safe area 적용

스토어 모바일에서 브라우저 툴바가 접힐 때 하단 고정 바(찜·장바구니·구매하기)가 화면 맨 아래
홈 인디케이터·둥근 모서리 영역까지 내려가 버튼이 잘려 보이는 문제를 고친다. 선행 조건 없이
바로 실행할 수 있다. 아이폰 실기기 확인이 필수다.

## 왜 필요한가

2026-11-18 아이폰 Chrome으로 `essesion.shop` 상품 상세를 본 화면에서 확인했다.

- 브라우저 하단 툴바가 보일 때: 바가 툴바 위에 온전히 놓인다.
- 스크롤해서 툴바가 접힐 때: 페이지가 화면 맨 아래까지 확장되고, 바의 버튼이 홈 인디케이터와
  화면 모서리 곡률 영역에 걸친다. 버튼 아래 여백은 두 상태 모두 약 12px로 같다. 즉 safe area
  만큼의 여백이 더해지지 않는다.

이 현상의 이름은 **safe area(안전 영역) 미적용**이고, 드러나는 계기는 모바일 브라우저의
**동적 툴바(dynamic toolbar) 접힘**이다.

이 문제는 우리 코드가 바뀌어서 생긴 것이 아니다. 반년 전까지는 같은 코드로 문제가 없었다.
아이폰 Chrome이 하단 툴바를 "Gemini에게 물어보기·새 탭·모든 탭" 구성으로 개편했고, 이 개편은
2026-03 테스트 빌드에서 시작해 2026-09 무렵 안정 버전으로 넓게 배포됐다
([PiunikaWeb 2026-09-14](https://piunikaweb.com/2026/09/14/get-rid-of-chrome-new-bottom-bar-ios/)).
문제 화면의 툴바가 바로 이 새 툴바다. 개편 뒤 툴바가 접힐 때 페이지가 화면 맨 아래까지
확장되는 방식이 달라진 것으로 **추정**한다. Chrome 쪽 공식 문서는 찾지 못했다.

원인은 코드에 이미 있는 `env(safe-area-inset-bottom)`이 0으로 계산되는 것이다.
`apps/store/index.html:5`의 viewport 메타에 `viewport-fit=cover`가 없다. 같은 툴바 개편
직후인 2026-11-17에 다른 프로젝트가 같은 구조(하단 바에 `env()` 패딩은 있고 메타에 cover가
없음)로 같은 문제를 보고했고, `viewport-fit=cover` 추가와 좌우 safe area 패딩으로 고쳤다
([이슈](https://github.com/vanyanv/chrisneddys-site/issues/310),
[PR](https://github.com/vanyanv/chrisneddys-site/pull/311)). 다만 그 PR은 inset을 에뮬레이션한
화면에서만 확인했고 아이폰 실기기 Chrome에서 확인했다는 기록은 없다. 그래서 "새 Chrome의
접힌 툴바 상태에서 cover를 넣으면 inset이 채워진다"는 것은 아직 **추정**이다. 절차 1이 이
추정을 검증한다.

오래된 자료를 근거로 삼지 않는다. iOS 26의 Safari도 하단 UI가 떠 있는 형태로 바뀌어서
2025년 이전 글의 동작 설명은 지금과 다를 수 있다. Safari 26.0에는 `fixed` 하단 요소가 떠 있는
툴바 위쪽에 맞춰지는 버그가 있었고 26.1에서 고쳐졌다는 보고가 있다
([WebKit 버그 297779](https://bugs.webkit.org/show_bug.cgi?id=297779)). 실행할 때 검색이
필요하면 2026-09 이후 자료만 쓴다.

`env(safe-area-inset-bottom)`을 이미 쓰는 곳은 다음 네 군데다. 메타 한 줄이 바뀌면 전부
함께 살아난다.

- `apps/store/src/shared/ui/content-layout.tsx:145` — 문제의 하단 바 (`ContentLayout`의 `actionBar`)
- `apps/store/src/shared/ui/scroll-top-button.tsx:29` — 맨 위로 버튼
- `apps/store/src/pages/design/customize.tsx:1112` — 디자인 편집 하단 패널
- `packages/shared/src/components/snackbar.tsx:182` — 스낵바

## 범위 밖

- admin(`apps/admin/index.html`)은 손대지 않는다. 데스크톱 전용 도구다.
- 가로 모드 전용 레이아웃을 새로 만들지 않는다. 절차 2의 최소 보정만 한다.
- 안드로이드 Chrome의 edge-to-edge 대응은 하지 않는다. 문제가 보고되면 별도 플랜으로 한다.

## 실행 조건

- 홈 인디케이터가 있는 아이폰 실기기가 있어야 하고, Chrome은 새 하단 툴바가 켜진 최신
  버전이어야 한다. 옛 툴바에서는 문제가 재현되지 않는다. 시뮬레이터 Safari로는 Chrome의 툴바 접힘을
  재현할 수 없다. 실기기가 없으면 실행하지 말고 기다린다.
- 실기기에서 로컬 dev 서버(`pnpm --filter store dev`)에 같은 네트워크로 접속해 확인한다.
  서버가 이미 떠 있는지 먼저 확인한다.

## 절차

1. `apps/store/index.html:5` viewport 메타의 `content`에 `viewport-fit=cover`를 추가한다.
   근거: inset이 0이 아닌 값으로 계산되게 하는 유일한 스위치다. 추가한 뒤 아이폰 Chrome과
   Safari에서 상품 상세를 스크롤해 툴바를 접고, 버튼 아래 여백이 홈 인디케이터 높이만큼
   늘어나는지 본다. 늘어나면 절차 2로 간다. 늘어나지 않으면 추정이 틀린 것이므로 이 변경을
   되돌리고 플랜을 다시 쓴다.
2. 가로 모드에서 좌우가 노치·모서리 밑으로 들어가는지 확인한다. `viewport-fit=cover`는
   브라우저가 가로 모드에서 자동으로 넣어 주던 좌우 여백을 없앤다. 내용이 가려지면
   `packages/shared/src/components/layout.tsx:8`의 최상위 `Box`에
   `env(safe-area-inset-left)`·`env(safe-area-inset-right)` 패딩을 넣는다. 한 곳에서 전체
   페이지를 보정하기 위해서다. 가려지지 않으면 아무것도 넣지 않는다.
3. `packages/shared/src/components/snackbar.tsx:182`의 `bottom` 식에서 inset 이중 합산을
   없앤다. `avoidBottom`은 하단 바의 실측 높이(`snackbar.tsx:63`)라서 inset이 살아나면 이미
   inset을 포함한다. 여기에 `env(safe-area-inset-bottom)`을 또 더하면 하단 바가 있는 화면에서
   스낵바가 inset만큼 더 뜬다. `avoidBottom`과 inset 중 큰 값 하나만 쓰도록 바꾼다. 하단 바가
   없는 화면에서는 inset이 그대로 적용돼야 하기 때문이다. admin은 cover가 없어 inset이 0이므로
   영향이 없다.
4. 나머지 세 군데는 코드를 바꾸지 않고 실기기에서 보기만 한다.
   `scroll-top-button.tsx:29`의 `76px + inset`은 하단 바 높이가 inset만큼 커지는 것과
   맞물리므로 그대로 둔다.
5. 실행을 마치면 결과를 `docs/reviews/`에 기록하고 이 문서를 지운다.

## 검증

아이폰 실기기에서 Chrome과 Safari 각각 다음을 본다.

- `/shop/<상품>`: 툴바가 접힌 상태에서 하단 바 버튼이 홈 인디케이터와 겹치지 않는다.
  툴바가 보이는 상태에서는 여백이 지금과 같다.
- 스크롤 맨 끝: 하단 바가 Footer 위에 자리 잡고 Footer를 가리지 않는다.
- `/design` 편집 화면: 하단 패널이 홈 인디케이터와 겹치지 않고 캔버스 높이가 줄지 않는다.
- 스낵바와 맨 위로 버튼이 하단 바와 겹치지 않고, 하단 바 바로 위에 붙어 뜬다(장바구니 담기로
  스낵바를 띄워 확인). 하단 바가 없는 화면의 스낵바는 홈 인디케이터와 겹치지 않는다.
- 가로 모드: 헤더 로고와 본문이 노치에 가리지 않는다.
- 데스크톱 브라우저: 변화가 없다.

코드 검사는 `pnpm lint`와 `pnpm typecheck`로 한다. 절차 3이 shared 패키지를 건드리므로
store만이 아니라 전체 타입체크를 돌린다.

## 되돌리는 법

`apps/store/index.html:5`에서 `viewport-fit=cover`를 지우면 원래대로 돌아간다. 가로 모드에서
내용이 노치에 가리거나, 툴바가 접히고 펴질 때 하단 바 높이가 눈에 띄게 튀면 되돌린다.

## 실패 모드

실기기 확인 없이 메타 한 줄만 넣고 끝내는 것이 이 플랜의 실패 모드다. 세로 모드 문제는
고쳐지고 가로 모드가 깨진 채 배포될 수 있다.

## 기각한 대안

- **하단 바 패딩을 고정값으로 늘린다** — 홈 인디케이터가 없는 기기와 툴바가 보이는 상태에서
  여백이 과해진다. `viewport-fit=cover`로 inset이 채워지지 않는 것이 절차 1에서 확인되면
  재론한다.
- **`visualViewport`로 가려진 높이를 재서 JS로 띄운다** — CSS 한 줄로 되는 일에 리스너를
  붙이는 것이다. 다만 `env(safe-area-inset-bottom)`은 홈 인디케이터 영역만 알려 주고 브라우저
  툴바 높이는 알려 주지 않는다. 절차 1 뒤에도 바가 툴바 **밑에 깔리는** 상태가 보이면 이 안을
  재론한다.
- **`sticky`를 `fixed`로 바꾼다** — `content-layout.tsx:132` 주석대로 `fixed`는 Footer를
  가린다. 그리고 원인은 위치 방식이 아니라 inset 값이다.
