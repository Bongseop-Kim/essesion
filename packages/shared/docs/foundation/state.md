# 상태

웹 기준 상호작용 상태 모델과 토큰 매핑. 색 선택은 [color-role.md](./color-role.md), 인터랙티브 컴포넌트 패턴은 `src/components/action-button.tsx`.

## 상태 흐름

`enabled` → `hover`(포인터 올림) → `pressed`(누름) / `selected`(선택 유지) / `disabled`(비활성) / `focus-visible`(키보드 포커스)

- seed는 모바일이라 pressed만 있지만, essesion은 웹이라 **hover가 1차 피드백**이다.

## 상태별 토큰·구현

| 상태 | 색 토큰 | 구현 |
|---|---|---|
| enabled | 기본 role(`bg.brand-solid` 등) | 기본 |
| hover | `-hover`(`bg.brand-solid-hover`) | Tailwind `hover:` (v4가 `@media (hover: hover)` 자동 적용) |
| pressed | `-pressed`(`bg.brand-solid-pressed`) | `:active` / Tailwind `active:` |
| selected | `stroke.brand`(테두리) 또는 `bg.brand-weak`(면) | 상태 클래스/prop |
| disabled (버튼류) | 색 유지 + 불투명도 | `opacity-50` + `pointer-events-none` |
| disabled (폼 필드) | `bg.disabled` + `fg.disabled` | 배경·텍스트 교체 — 내부 콘텐츠에 불투명도 중첩 방지 |
| focus-visible | `stroke.focus-ring` | `focus-visible:outline-2 outline-offset-2 outline-stroke-focus-ring` |

## 규칙

- **hover/pressed 색 전환**은 `--duration-fast`(100ms) + `--ease-standard`. → [motion.md](./motion.md)
- **disabled는 hover/pressed와 조합 불가** — `pointer-events-none`으로 상호작용을 차단한다. 불투명도 50%로 표시.
- **focus-visible 전용** — 마우스 클릭 시 링을 노출하지 않는다(`focus`가 아니라 `focus-visible`). → [inclusive-design.md](./inclusive-design.md)
- **상태를 색 하나로만 전달 금지** — selected·error 등은 아이콘·텍스트·형태를 병행한다.
- brand solid는 hover/pressed에서 **밝아지고**(검정 관례), 유채 solid는 어두워진다. → [color-system.md](./color-system.md)
