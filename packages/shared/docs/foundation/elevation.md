# 엘리베이션

표면 층위(layer)와 그림자 매핑. 값은 [design-token-reference.md](./design-token-reference.md), 역할 규칙은 [color-role.md](./color-role.md).

## layer 3단 (낮음 → 높음)

| 토큰 | 값 | 위치 |
|---|---|---|
| `bg.layer-basement` | gray-100 `#f7f8f9` | 페이지 배경(주로 admin 대시보드) — 가장 아래 |
| `bg.layer-default` | `#ffffff` | 기본 표면(카드·콘텐츠 면) |
| `bg.layer-floating` | `#ffffff` | 떠 있는 면(모달·드롭다운·토스트) |

- admin: `bg.layer-basement` 배경 위에 `bg.layer-default` 카드를 얹어 층을 만든다. → [layout.md](./layout.md)
- store: 페이지 배경도 대개 `bg.layer-default`(흰색). basement는 카드가 배경과 구분돼야 할 때만.

## 표현 수단 우선순위

층위는 다음 순서로 표현한다. 위쪽을 먼저 쓰고, 부족할 때만 아래로 내려간다.

1. **표면색** — layer 토큰으로 배경을 달리한다(가장 저렴·안정적).
2. **선** — `stroke.neutral-weak`로 경계를 준다.
3. **그림자** — 위 둘로 부족한 "떠 있음"에만.

## 그림자 매핑

| 그림자 | 값 | 대상 |
|---|---|---|
| `s1` | `0 1px 4px 0 rgb(0 0 0 / 0.08)` | 카드·낮은 부양 |
| `s2` | `0 2px 10px 0 rgb(0 0 0 / 0.1)` | 드롭다운·팝오버 |
| `s3` | `0 4px 16px 0 rgb(0 0 0 / 0.12)` | 모달·다이얼로그 |

## 규칙

- 그림자 남용 금지 — 평면 위주 디자인이다. 카드는 대개 선(`stroke.neutral-weak`)만으로 충분하다.
- 부양 높이(z 순서)와 그림자 단계를 일치시킨다: 떠 있을수록 큰 그림자.
- 그림자 값을 임의 정의하지 말 것. s1~s3만 사용.

- **딤(overlay)** — 모달 `<dialog>`의 `::backdrop`은 `bg.overlay`(45% 검정) 전용 토큰을 쓴다. 다른 용도의 어둡기 표현에 전용하지 말 것. → [overlay.md](./overlay.md)
