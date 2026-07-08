# 색 시스템

모노크롬 브랜드(#111111)를 운용하는 원칙. 역할별 토큰 선택은 [color-role.md](./color-role.md), 값은 [design-token-reference.md](./design-token-reference.md).

## 원칙

1. **위계는 무채색으로.** 화면의 층위·강약은 gray 스케일과 타이포·간격으로 만든다. 색으로 위계를 만들지 않는다.
2. **유채색은 상태 전달 전용.** critical(빨강)·positive(초록)·warning(노랑)·informative(파랑), 그리고 포커스 링(파랑)에만 쓴다. 장식·브랜딩 목적의 유채색 없음. → [gradient.md](./gradient.md)
3. **역할 기반 색이 기본.** 컴포넌트는 시맨틱 토큰(`fg.*`/`bg.*`/`stroke.*`)만 참조한다. 팔레트 직접 참조 금지. → [palette.md](./palette.md)
4. **상태를 색 하나로만 전달하지 않는다.** 색맹·저대비 환경 대비로 아이콘·텍스트·형태를 병행한다. → [inclusive-design.md](./inclusive-design.md)

## 브랜드 solid의 hover/pressed

- 브랜드 면은 검정(`#111111`)이다. 검정은 더 어둡게 갈 수 없으므로, 상호작용 피드백은 **밝기를 올려서** 준다(검정 버튼의 관례).
- `bg.brand-solid` `#111111` → hover `#2b2b2b` → pressed `#404040`.
- 유채 solid(critical·positive·informative)는 반대로 **어둡게** 내린다(700→800→900). warning은 solid가 없다.

## 텍스트색 3단

본문/보조/약한 순으로 밝아진다. 이보다 연한 회색을 텍스트에 쓰지 않는다(대비 하한).

| 토큰 | 값 | 용도 |
|---|---|---|
| `fg.neutral` | gray-1000 | 본문·제목 |
| `fg.neutral-muted` | gray-800 | 보조 설명 |
| `fg.neutral-subtle` | gray-700 | 캡션·플레이스홀더(텍스트 대비 하한) |

## 면·선

- 면: `bg.layer-*`(elevation), `bg.neutral-weak`(옅은 강조 면), `bg.brand-weak`(선택 면). → [elevation.md](./elevation.md)
- 선: `stroke.neutral`(테두리), `stroke.neutral-weak`(구분선), `stroke.brand`(선택 테두리), `stroke.focus-ring`(포커스, 모노크롬 위 식별을 위해 유채 파랑 유지).
