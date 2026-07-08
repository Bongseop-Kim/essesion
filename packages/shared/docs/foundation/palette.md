# 팔레트

색 스케일(raw 재료)과 대표 용도. **컴포넌트에서 직접 사용 금지** — 팔레트는 시맨틱 토큰의 재료다. 시맨틱 선택은 [color-role.md](./color-role.md), 값은 [design-token-reference.md](./design-token-reference.md).

## gray 11단

무채색 위계의 뼈대. 00(가장 밝음)→1000(가장 어두움).

| 단 | 값 | 대표 용도(어떤 시맨틱이 참조하나) |
|---|---|---|
| `gray-00` | `#ffffff` | 표면(`bg.layer-default`) |
| `gray-100` | `#f7f8f9` | 페이지 배경 basement(`bg.layer-basement`) |
| `gray-200` | `#f3f4f5` | 옅은 강조 면(`bg.neutral-weak`, `bg.brand-weak`) |
| `gray-300` | `#eeeff1` | 구분선(`stroke.neutral-weak`), weak 면 hover |
| `gray-400` | `#dcdee3` | 테두리(`stroke.neutral`), weak 면 pressed |
| `gray-500` | `#d1d3d8` | 예비(현재 시맨틱 미참조) |
| `gray-600` | `#b0b3ba` | 예비 — 텍스트 대비 하한 미만이라 텍스트 금지 |
| `gray-700` | `#868b94` | 약한 텍스트 경계(`fg.neutral-subtle`) |
| `gray-800` | `#555d6d` | 보조 텍스트(`fg.neutral-muted`) |
| `gray-900` | `#2a3038` | 예비 |
| `gray-1000` | `#1a1c20` | 본문·제목(`fg.neutral`) |

## 유채 램프 (critical=red · positive=green · warning=yellow · informative=blue)

- 각 램프 6단: **100 / 200 / 300 / 700 / 800 / 900**. 밝은 3단은 `-weak` 면·hover·경계, 어두운 3단은 `solid`·`fg`·`stroke`에 쓰인다.
- 중간대(400~600)를 비운 이유: 시맨틱 수요(weak 면 + solid 3상태 + fg + stroke)를 채울 만큼만 둔다. 그래디언트·차트용 연속 스펙트럼이 아니다.
- **예외** — blue만 포커스 링용 `blue-600`(`#5e98fe`)을 추가로 둔다(모노크롬 위 식별성 확보, `stroke.focus-ring`).

| 단 | red | green | yellow | blue | 주 쓰임 |
|---|---|---|---|---|---|
| 100 | `#fdf0f0` | `#edfaf6` | `#fff7de` | `#eff6ff` | `-weak` 면 |
| 200 | `#fde7e7` | `#d9f6e9` | `#fdefb9` | `#e2edfc` | weak hover |
| 300 | `#fed4d2` | `#b9e9d2` | `#fbdc65` | `#cbdffa` | 경계·테두리 |
| 600 | – | – | – | `#5e98fe` | 포커스 링(blue 전용) |
| 700 | `#fa342c` | `#079171` | `#9b7821` | `#217cf9` | solid·stroke |
| 800 | `#ca1d13` | `#00745f` | `#755b22` | `#135fcd` | solid hover·`fg` |
| 900 | `#921708` | `#075445` | `#4f3e1f` | `#0b4596` | solid pressed |

## 추가 기준

- 차트·데이터 시각화 등 연속 스펙트럼이 필요해지면 그때 별도 램프를 추가한다(시맨틱 없이 팔레트만 늘리지 않는다).
- 새 색이 필요하면 팔레트 단 추가 + 이를 참조하는 시맨틱 토큰을 함께 제안한다.
