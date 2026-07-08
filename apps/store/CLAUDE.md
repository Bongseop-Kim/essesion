# store 앱 UI 규칙

UI는 `@essesion/shared`로만 작성한다. 규칙 원본: `packages/shared/AGENTS.md` (필독).

- **우선순위 사다리**: ① shared 공통 컴포넌트(AGENTS.md 색인 표 확인) → ② 프리미티브(Box/Flex/HStack/VStack/Grid/Float)+토큰 조합 → ③ 표현 불가 시 **멈추고** shared에 토큰/컴포넌트 추가 제안. 앱 로컬 재구현·임의 값 우회 금지.
- 타이포는 Text+textStyle, 아이콘은 Icon+@heroicons/react.
- `pnpm lint`가 하네스 정적 검사(`scripts/check-harness.mjs`)를 포함한다.
