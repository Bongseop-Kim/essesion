# 그라디언트

정책: **장식용 그라디언트를 두지 않는다.**

- essesion은 모노크롬 브랜드(#111111)다. 브랜딩·장식 목적의 그라디언트 토큰은 없다. → [color-system.md](./color-system.md)
- 스켈레톤 shimmer가 필요해지면 Skeleton 컴포넌트에서 **지역 정의**한다(공용 토큰을 선점하지 않는다).
- **기능성 딤·스크림은 장식이 아니다** — 이미지 위 텍스트 가독성용 스크림은 `bg.image-scrim` 토큰을 쓴다. 두 가지 소비를 허용한다: ① 단색 딤이 필요하면 `bg-bg-image-scrim`(모달 backdrop `bg.overlay`와 같은 계열), ② 방향성 페이드가 필요하면 `.scrim-{top,bottom,left,right}` 유틸리티(`bg.image-scrim` → 투명). ②는 Skeleton shimmer와 같은 **기능성 그라디언트 예외**이며, 색은 반드시 `bg.image-scrim` 토큰에서만 온다 — 임의 색/방향으로 손수 그라디언트를 조립하지 말 것(rule 0: 새 스크림 형태가 필요하면 여기에 토큰/유틸리티를 먼저 추가). 장식·브랜딩 그라디언트는 여전히 금지. → [design-token-reference.md](./design-token-reference.md)
- 데이터 시각화용 그라디언트(연속 스펙트럼)는 차트를 도입할 때 별도로 결정한다. → [palette.md](./palette.md)
