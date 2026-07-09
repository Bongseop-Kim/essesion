# 그라디언트

정책: **장식용 그라디언트를 두지 않는다.**

- essesion은 모노크롬 브랜드(#111111)다. 브랜딩·장식 목적의 그라디언트 토큰은 없다. → [color-system.md](./color-system.md)
- 스켈레톤 shimmer가 필요해지면 Skeleton 컴포넌트에서 **지역 정의**한다(공용 토큰을 선점하지 않는다).
- **기능성 딤은 장식이 아니다** — 이미지 위 텍스트 가독성용 스크림은 `bg.image-scrim`(단색 딤, 그라디언트 아님) 토큰을 쓴다. 모달 backdrop `bg.overlay`와 같은 계열의 기능성 예외. → [design-token-reference.md](./design-token-reference.md)
- 데이터 시각화용 그라디언트(연속 스펙트럼)는 차트를 도입할 때 별도로 결정한다. → [palette.md](./palette.md)
