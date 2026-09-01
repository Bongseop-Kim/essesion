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

## chart-categorical 7슬롯 (데이터 시각화 전용)

계열(주문 유형 등) **식별**만을 위한 색이다. 모노크롬 원칙의 예외이며 차트 밖에서는 쓰지 않는다.

| 슬롯 | 색상 | 값 | 시맨틱 |
|---|---|---|---|
| 1 | blue | `#2a78d6` | `bg.chart-1` |
| 2 | orange | `#d95926` | `bg.chart-2` |
| 3 | aqua | `#199e70` | `bg.chart-3` |
| 4 | yellow | `#c98500` | `bg.chart-4` |
| 5 | magenta | `#d55181` | `bg.chart-5` |
| 6 | green | `#008300` | `bg.chart-6` |
| 7 | violet | `#4a3aa7` | `bg.chart-7` |

- **슬롯 순서가 색각이상 안전장치다** — 순서를 바꾸거나 색을 돌려쓰지 않는다. 색은 계열(엔티티)에 고정하고 크기 순위를 따라가지 않는다. 계열이 7개를 넘으면 8번째 색을 만들지 말고 '기타'로 접는다.
- **상태색(critical·positive·warning·informative) 재사용 금지** — 빨간 막대는 오류로 읽힌다. 성공/실패처럼 상태가 진짜 의미인 차트에서만 상태색을 쓴다.
- 값 출처: Claude `dataviz` 스킬의 레퍼런스 카테고리 팔레트를 우리 차트 표면(`bg.layer-default` `#ffffff`)에 맞춰 재검증한 7슬롯. **인접쌍 기준**(스택·그룹 막대·선의 판정 기준) CVD ΔE 8.4(≥8)·정상시 ΔE 19.3(≥15)·표면 대비 전 슬롯 3:1 모두 통과. 값을 바꾸면 `validate_palette.js`로 재검증할 것.
- **한계 — 이 7색은 스택·그룹 막대·선 전용이다.** 임의의 두 계열이 맞닿는 형태(산점도·버블·코로플레스·small multiples, `--pairs all`)는 7슬롯으로 통과하는 조합이 존재하지 않는다(하나 걸러 있는 슬롯끼리는 색각이상에서 구분이 무너진다). 그런 차트는 계열을 3개로 줄이거나 분할할 것. 스택에서도 중간 계열이 0이면 비인접 슬롯이 맞닿으므로 **범례와 계열별 값 툴팁을 반드시 함께 둔다** — 색만으로 계열을 구분하게 두지 않는다.
- 연속 스펙트럼(히트맵 등 순차 램프)은 아직 없다 — 필요해지면 단일 색상 램프를 별도로 추가한다.

## 추가 기준

- 새 색이 필요하면 팔레트 단 추가 + 이를 참조하는 시맨틱 토큰을 함께 제안한다.
