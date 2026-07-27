# admin 앱 UI 규칙

UI는 `@essesion/shared`로만 작성한다. 규칙 원본: `packages/shared/AGENTS.md` (필독).

- **우선순위 사다리**: ① shared 공통 컴포넌트(AGENTS.md 색인 표 확인) → ② 프리미티브(Box/Flex/HStack/VStack/Grid/Float)+토큰 조합 → ③ 표현 불가 시 **멈추고** shared에 토큰/컴포넌트 추가 제안. 앱 로컬 재구현·임의 값 우회 금지.
- 타이포는 Text+textStyle(admin 기본 bodySm), 아이콘은 Icon+@heroicons/react.
- 금액·수량 등 정수 입력은 `shared/ui/number-field`의 `NumberField`(천 단위 콤마 표시, 값은 콤마 없는 문자열). `type="number"`는 콤마를 못 넣으므로 쓰지 않는다 — 소수점 입력(cm 등)만 예외. 범위 검증은 화면의 JS 검증으로.
- `pnpm lint`가 하네스 정적 검사(`scripts/check-harness.mjs`)를 포함한다.
