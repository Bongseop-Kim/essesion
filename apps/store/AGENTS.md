# store 앱 UI 규칙

UI는 `@essesion/shared`로만 작성한다. 규칙 원본: `packages/shared/AGENTS.md` (필독).
페이지 레이아웃·결제 UI 조각을 선택하기 전 `src/shared/ui/AGENTS.md`도 읽는다.

- **우선순위 사다리**: ① shared 공통 컴포넌트(AGENTS.md 색인 표 확인) → ② 프리미티브(Box/Flex/HStack/VStack/Grid/Float)+토큰 조합 → ③ 표현 불가 시 **멈추고** shared에 토큰/컴포넌트 추가 제안. 앱 로컬 재구현·임의 값 우회 금지.
- 타이포는 Text+textStyle, 아이콘은 Icon+@heroicons/react.
- 인증이 필요한 액션·라우트는 `useAuthGuard().requireAuth(...)` 또는 `ProtectedRoute`로 확인 `AlertDialog`를 먼저 표시한다. 명시적인 로그인 버튼과 인증 콜백을 제외하고 `/login`으로 직접 이동하지 않는다.
- `pnpm lint`가 하네스 정적 검사(`scripts/check-harness.mjs`)를 포함한다.
