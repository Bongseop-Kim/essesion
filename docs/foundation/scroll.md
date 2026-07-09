# Scroll

## 원칙

- 가로 스크롤은 모두 `ScrollFog direction="horizontal"`을 쓴다.
- 가로 scrollbar는 보이지 않게 숨긴다. 스크롤 가능 여부는 scrollbar가 아니라 `ScrollFog`의 좌우 edge fog로 전달한다.
- 앱 코드에서 `overflowX="auto|scroll"` 또는 `overflow-x-auto|scroll`을 직접 쓰지 않는다. 하네스가 차단한다.

## 세로 스크롤

- 세로 scrollbar는 상황별로 판단한다. 긴 문서·테이블·관리 화면처럼 위치 파악이 중요한 PC UI는 표시해도 된다.
- 모바일 시트·모달·짧은 목록은 공간이 좁으므로 edge fog, sticky action, PullToRefresh 같은 맥락 신호를 우선한다.
- 세로 스크롤 컨테이너는 기존처럼 `overflowY="auto"`를 쓸 수 있다. 단, 스크롤 가능 여부가 불명확한 짧은 영역이면 `ScrollFog` vertical을 우선 검토한다.

## 구현

- `ScrollFog`는 horizontal일 때 내부적으로 scrollbar를 숨긴다.
- 직접 horizontal overflow가 필요해 보이면 먼저 `ScrollFog`로 감싼다. 예외가 필요하면 줄 끝 `// harness-ignore`에 사유를 남긴다.
