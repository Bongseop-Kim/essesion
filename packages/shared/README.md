# @essesion/shared

admin·store 공용 디자인 시스템 + 유틸. DTO는 `packages/api-client` 생성물이 대체하므로 여기 두지 않는다 (ARCHITECTURE §4).

- `cn()` — clsx + tailwind-merge 클래스 결합
- `theme.css` — 디자인 토큰(`@theme`). 각 앱 `index.css`에서 import하고, 앱 쪽에 `@source "../../../packages/shared/src"`로 이 패키지 소스를 Tailwind 스캔에 등록해야 한다.
- `components/` — UI 프리미티브. 빌드 없이 소스 직배포(`exports` → `src/index.ts`), 앱 Vite가 컴파일.
