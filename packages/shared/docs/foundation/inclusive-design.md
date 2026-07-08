# 포용적 디자인

접근성 기준 — 대비·포커스·클릭 타깃·모션. 색 선택은 [color-role.md](./color-role.md), 문구는 [writing.md](./writing.md).

## 대비 (APCA)

| 대상 | Lc 기준 |
|---|---|
| 본문 텍스트 | 75+ (권장 90) |
| 큰 글씨·굵은 글씨 | 60+ |
| 비활성·플레이스홀더 | 30+ |

- **텍스트에 gray-600 이하(=`fg.*`로 지정되지 않은 연한 회색)를 쓰지 말 것.** `fg.neutral-subtle`(gray-700)이 텍스트 대비 하한이다. → [palette.md](./palette.md)
- 상태색 텍스트는 어두운 `fg.*`(critical=red-800 등)를 쓰고, 밝은 solid 값을 텍스트로 쓰지 않는다.

## 색에만 의존 금지

- 상태를 색 하나로만 전달하지 않는다 — 아이콘·텍스트·형태를 병행한다(색맹·저대비 대비). → [state.md](./state.md)

## 포커스

- **키보드 포커스는 `focus-visible` 전용**(마우스 클릭 시 링 노출 금지).
- 링 색은 `stroke.focus-ring`(파랑) — 모노크롬 화면 위 식별을 위해 유채 유지.
- 패턴: `focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring`.

## 클릭 타깃

- 최소 **24×24px**.
- store 모바일 주요 액션(주문·담기 등)은 **44×44px** 이상. → [layout.md](./layout.md)

## 그 외

- **이미지 alt** — 의미 있는 이미지는 `alt` 필수, 장식 이미지는 `alt=""`.
- **장식 아이콘** — 기본 `aria-hidden`(Icon 컴포넌트 기본 동작). 의미 전달 아이콘만 `aria-label` 부여.
- **에러·동적 알림** — `aria-live`로 스크린리더에 전달.
- **모션** — `prefers-reduced-motion: reduce` 존중(전환 최소화). → [motion.md](./motion.md)
- **폼** — 모든 입력에 연결된 `<label>`. 플레이스홀더로 레이블 대체 금지. → [writing.md](./writing.md)
