# 색 역할

Property × Role × Variant × State 매트릭스와 토큰 선택 순서. 값은 [design-token-reference.md](./design-token-reference.md), 운용 원칙은 [color-system.md](./color-system.md).

## 선택 순서

1. **무엇에 칠하나** — 텍스트·아이콘이면 `fg.*`, 면이면 `bg.*`, 선(테두리·구분선·포커스)이면 `stroke.*`.
2. **어떤 의미인가** — 중립이면 `neutral`, 상태면 `critical`/`positive`/`warning`/`informative`, 브랜드 강조면 `brand`, 표면 층위면 `bg.layer-*`.
3. **채움인가 옅은 면인가** — 강한 채움 `solid`, 옅은 배경 `weak`.
4. **상호작용 상태** — hover면 `-hover`, 누름이면 `-pressed`. → [state.md](./state.md)

## 매트릭스

`✓` = 존재, `–` = 없음(의도적).

| Role | `fg.*` | `bg.*-solid` | `bg.*-weak` | `stroke.*` |
|---|---|---|---|---|
| neutral | ✓ (neutral / -muted / -subtle) | – | ✓ (neutral-weak +hover/pressed) | ✓ (neutral / -weak) |
| brand | ✓ | ✓ (+hover/pressed) | ✓ | ✓ |
| critical | ✓ | ✓ (+hover/pressed) | ✓ | ✓ |
| positive | ✓ | ✓ (+hover/pressed) | ✓ | ✓ |
| warning | ✓ | **–** | ✓ | ✓ |
| informative | ✓ | ✓ (+hover/pressed) | ✓ | ✓ |
| contrast | ✓ (solid 면 위 텍스트) | – | – | – |
| layer | – | (basement/default/floating) | – | – |

## 규칙

- **contrast** — `fg.contrast`(#ffffff)는 solid 배경 위 텍스트 전용. 밝은 면 위에 쓰지 말 것.
- **layer** — `bg.layer-basement`/`-default`/`-floating`는 elevation(표면 층위) 전용이다. 상태 표시나 강조 면으로 전용하지 말 것. → [elevation.md](./elevation.md)
- **warning에 solid가 없는 이유** — 노랑 solid + 흰 글자는 APCA 대비 미달. warning은 `bg.warning-weak` + `fg.warning`(어두운 노랑) 조합으로만 쓴다. → [inclusive-design.md](./inclusive-design.md)
- **선택 상태** — 칩·탭·카드 선택은 `stroke.brand`(테두리) 또는 `bg.brand-weak`(면)으로. → [state.md](./state.md)

## 금지 조합

- `fg.*`를 배경으로, `bg.*`를 텍스트로 쓰지 말 것(대비 보증이 깨진다).
- `weak` 면 위에 같은 role의 `weak` 텍스트(예: `bg.critical-weak` + `fg.contrast`) 금지 — weak 면 위 텍스트는 해당 role의 `fg.*`(어두운 값)를 쓴다.
- 팔레트 직접 참조(`palette.gray-500`) 금지. → [palette.md](./palette.md)
