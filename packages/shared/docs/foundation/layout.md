# 레이아웃

store·admin의 페이지 골격과 반응형 규칙. 레이아웃은 프리미티브(`Box`/`Flex`/`HStack`/`VStack`/`Grid`/`Float`)로만 — raw `<div>` + Tailwind 레이아웃 클래스 금지. 간격은 [spacing.md](./spacing.md).

## 브레이크포인트 (모바일 퍼스트, min-width)

| 키 | 값 | prop | Tailwind |
|---|---|---|---|
| base | 0~ | 기본값 | (접두 없음) |
| `sm` | 480px | `{ sm: … }` | `sm:` |
| `md` | 768px | `{ md: … }` | `md:` |
| `lg` | 1280px | `{ lg: … }` | `lg:` |
| `xl` | 1440px | `{ xl: … }` | `xl:` |

- 프리미티브 prop은 `ResponsiveValue`: `p={{ base: "x4", md: "x8" }}`. 하향 fallback(지정 안 된 상단은 아래 값 사용).
- Tailwind 쪽은 `md:` variant. 같은 속성을 prop과 className 양쪽에 걸지 말 것.

## store (고객)

- 콘텐츠 최대폭 **1280px**(`LayoutContent` medium), 중앙 정렬(`maxWidth` + `mx="auto"`). Header·콘텐츠·Footer 동일 폭.
- 페이지 거터(넓어질수록 증가): 모바일 `x4`(16px), md `x6`(24px), lg `x8`(32px) → `px={{ base: "x4", md: "x6", lg: "x8" }}`.
- 상품 그리드: `<Grid columns={{ base: 2, md: 3, lg: 4 }} gap="x4">`.
- 페이지 배경은 대개 `bg.layer-default`(흰색). 주요 모바일 액션은 44×44px 이상. → [inclusive-design.md](./inclusive-design.md)

## admin (운영자)

- 사이드바 + 본문: `<Grid templateColumns="240px 1fr">`.
- 사이드바는 md 미만에서 숨김(반응형 `display`: `display={{ base: "none", md: "block" }}`).
- 배경 `bg.layer-basement` 위에 `bg.layer-default` 카드를 얹어 층을 만든다. → [elevation.md](./elevation.md)
- 기본 본문 타이포는 `bodySm`, 테이블 숫자는 tabular-nums·우측 정렬. → [typography.md](./typography.md) · [international-design.md](./international-design.md)

## 규칙

- 요소 간 간격은 부모의 `gap` 우선(마진 대신). → [spacing.md](./spacing.md)
- 겹침 배치는 부모 `position="relative"` + `Float`.
- 구조값(`columns`·`width`·`flex`·`zIndex`)은 숫자 허용, 시각값(간격·색·라운드)은 토큰만.
