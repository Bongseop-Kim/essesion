# @essesion/shared

admin·store 공용 디자인 시스템 + 유틸. DTO는 `packages/api-client` 생성물이 대체하므로 여기 두지 않는다 (ARCHITECTURE §4).

**UI 작업 전 `AGENTS.md`(하네스 규칙) 필독. 심화 문서는 `docs/foundation/`, 토큰 값 사전은 `docs/foundation/design-token-reference.md`.**

- `theme.css` — 디자인 토큰(`@theme static`, 브랜드 #111111·라이트 온리). 각 앱 `index.css`에서 import하고, 앱 쪽에 `@source "../../../packages/shared/src"`로 이 패키지 소스를 Tailwind 스캔에 등록해야 한다.
- `components/` — 레이아웃 프리미티브(Box·Flex·HStack·VStack·Grid·Float·Text·Icon, 토큰 타입 style prop + ResponsiveValue) + 인터랙티브 컴포넌트(Button, Tailwind 레코드 패턴). 빌드 없이 소스 직배포(`exports` → `src/index.ts`), 앱 Vite가 컴파일.
- `cn()` — clsx + tailwind-merge(커스텀 t-스케일 등록) 클래스 결합
- 테스트: `pnpm test` (vitest) — 리졸버·반응형·토큰 드리프트 가드
