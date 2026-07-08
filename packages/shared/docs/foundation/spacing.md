# 간격

x-스케일과 용도. 4px 그리드. 간격 prop에 raw 숫자 금지(`p={16}` ✗, `p="x4"` ✓). 값은 [design-token-reference.md](./design-token-reference.md).

## 4px 그리드

- 모든 간격은 4px 배수(`x1`=4px). 세밀 조정용 반 단계(`x0_5`=2px, `x1_5`=6px, `x2_5`=10px, `x3_5`=14px, `x4_5`=18px)만 예외.
- 전 단계: [design-token-reference.md](./design-token-reference.md#간격-x-스케일-4px-그리드).

## 용도 매핑

| 구간 | 토큰 | 예 |
|---|---|---|
| 컴포넌트 내부(아이콘↔텍스트, 인풋 패딩) | `x1`~`x3` | 버튼 `gap="x2"` |
| 관련 요소 간 | `x4` | 폼 필드 사이 `gap="x4"` |
| 섹션 간 | `x8`~`x12` | 페이지 섹션 사이 |
| 페이지 거터 | `x4`(모바일) / `x6`(md+) | → [layout.md](./layout.md) |

## 규칙

- **gap 우선** — 요소 간 간격은 부모의 `gap`으로. 자식마다 마진 붙이기 지양(`Flex`/`Grid`의 `gap`).
- 마진은 이웃 간 간격에만. 상하 마진 중복(margin collapse 의존) 금지 — 한쪽에만 준다.
- 시각적 간격에 raw 숫자·`p-4` 같은 Tailwind 기본 스케일 대신 x-스케일(`p="x4"`/`p-x4`)을 쓴다.
- 구조 치수(고정 width/height 등)는 숫자 허용. 간격(패딩·마진·gap)은 토큰만.
