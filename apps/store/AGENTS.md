# store 앱 UI 규칙

UI는 `@essesion/shared`로만 작성한다. 규칙 원본: `packages/shared/AGENTS.md` (필독).
페이지 레이아웃·결제 UI 조각을 선택하기 전 `src/shared/ui/AGENTS.md`도 읽는다.

- **우선순위 사다리**: ① shared 공통 컴포넌트(AGENTS.md 색인 표 확인) → ② 프리미티브(Box/Flex/HStack/VStack/Grid/Float)+토큰 조합 → ③ 표현 불가 시 **멈추고** shared에 토큰/컴포넌트 추가 제안. 앱 로컬 재구현·임의 값 우회 금지.
- 타이포는 Text+textStyle, 아이콘은 Icon+@heroicons/react.
- 인증이 필요한 액션·라우트는 `useAuthGuard().requireAuth(...)` 또는 `ProtectedRoute`로 확인 `AlertDialog`를 먼저 표시한다. 명시적인 로그인 버튼과 인증 콜백을 제외하고 `/login`으로 직접 이동하지 않는다.
- `pnpm lint`가 하네스 정적 검사(`scripts/check-harness.mjs`)를 포함한다.

## 이미지·영상 에셋

- **공개 업로드 이미지(상품·리뷰·팝업)**는 형식·크기를 신경 쓰지 않고 올려도 된다. 대신 화면에 표시할 때 반드시 `resizedImage(url, 600 | 1200)`(`src/shared/lib/image-url.ts`)을 거쳐 `ImageFrame`에 펼쳐 넣는다 — Cloudflare가 리사이즈·WebP/AVIF로 내려주고, 실패하면 원본으로 폴백한다. 너비는 카드·썸네일 600, 그 외 1200 두 가지만 쓴다(고유 변환 수가 무료 한도 기준).
- **`public/images/` 정적 에셋**은 변환을 거치지 않는다 — 직접 WebP로, 표시 크기 기준(카드는 긴 변 800px, `cwebp -q 78`)으로 넣는다. 하루 캐시(`public/_headers`)가 걸려 있으니 교체할 때는 파일명을 바꾼다.
- **mp4**는 해상도 유지, 오디오 제거, `libx264 -crf 28 -preset slow -movflags +faststart`로 재인코딩해서 넣는다.
- `og-image.png`·파비콘은 SNS 미리보기·브라우저 호환을 위해 PNG로 둔다.
- `ImageFrame`은 기본이 지연 로딩이다. 첫 화면에 보이는 이미지만 `loading="eager" fetchPriority="high"`로 덮어쓴다.
