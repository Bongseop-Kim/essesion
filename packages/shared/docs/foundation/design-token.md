# 디자인 토큰

토큰 체계의 원리 — 왜 2계층인지, 이름을 어떻게 읽는지, prop과 Tailwind가 어떻게 대응하는지. 전 토큰 값은 [design-token-reference.md](./design-token-reference.md).

## 2계층: 팔레트(scale) → 시맨틱(semantic)

- **팔레트(scale)** — raw 값(`#1a1c20`)을 유한한 스케일로 묶은 것. `--color-palette-gray-1000`, `--color-palette-red-700`. 색의 "재료"이지 의도가 아니다.
- **시맨틱(semantic)** — 팔레트를 참조해 "쓰임"을 표현. `--color-fg-neutral: var(--color-palette-gray-1000)`. 컴포넌트는 시맨틱만 본다.
- 이유: 의도가 이름에 담기면(본문색=`fg.neutral`) 값이 바뀌어도 호출부는 그대로다. 다크모드·리브랜딩은 시맨틱 매핑만 갈아끼우면 된다.
- **팔레트 직접 사용 금지.** 맞는 시맨틱이 없으면 임의 팔레트를 쓰지 말고 시맨틱 토큰 추가를 먼저 제안한다. → [palette.md](./palette.md)

## 명명 문법

`{property}.{role}[-{variant}][-{state}]`

- **property** — `fg`(전경/텍스트·아이콘) · `bg`(배경/면) · `stroke`(선)
- **role** — `brand` `neutral` `critical` `positive` `warning` `informative` `layer`
- **variant** — `solid`(채움) · `weak`(옅은 면). 없으면 단일 값(`fg.neutral`).
- **state** — `-hover` · `-pressed`. 기본(enabled)은 접미 없음.
- 예: `bg.brand-solid-hover`, `fg.neutral-subtle`, `stroke.focus-ring`. 역할 매트릭스는 [color-role.md](./color-role.md).

## CSS 변수 네임스페이스

| 접두 | 대상 | 예 |
|---|---|---|
| `--color-*` | 색(시맨틱·팔레트) | `--color-fg-neutral`, `--color-palette-gray-100` |
| `--spacing-x*` | 간격 | `--spacing-x4` |
| `--radius-r*` | 라운드 | `--radius-r2` |
| `--shadow-s*` | 그림자 | `--shadow-s1` |
| `--text-t*` | 폰트 크기·행간 | `--text-t5`, `--text-t5--line-height` |
| `--breakpoint-*` | 반응형 경계 | `--breakpoint-md` |
| `--ease-*` | 이징 | `--ease-standard` |
| `--duration-*` | 전환 시간(`:root`) | `--duration-fast` |

## prop 표기 ↔ Tailwind 유틸리티

같은 토큰을 두 방식으로 쓴다. 프리미티브 prop은 점 표기, Tailwind는 CSS 변수의 `--color-` 뒤 이름을 그대로 유틸에 얹는다.

| 쓰임 | prop (프리미티브) | Tailwind |
|---|---|---|
| 텍스트색 | `color="fg.neutral"` | `text-fg-neutral` |
| 배경색 | `bg="bg.brand-solid"` | `bg-bg-brand-solid` |
| 테두리색 | `borderColor="stroke.neutral"` | `border-stroke-neutral` |
| 포커스 링 | — | `outline-stroke-focus-ring` |
| 라운드 | `borderRadius="r2"` | `rounded-r2` |
| 그림자 | `boxShadow="s1"` | `shadow-s1` |
| 간격 | `p="x4"` `gap="x4"` | `p-x4` `gap-x4` |
| 폰트 크기 | (textStyle 사용) | `text-t3` |

- `bg-bg-…`처럼 접두가 겹쳐 보이는 건 정상이다. 앞의 `bg-`는 Tailwind 속성(background), 뒤의 `bg-`는 색 이름(role property).
- 어느 쪽을 쓰나: 레이아웃·일회성 스타일은 프리미티브 prop, shared 인터랙티브 컴포넌트(Button 등)는 Tailwind variant 레코드. → [state.md](./state.md)
- 같은 속성을 prop과 className 양쪽에 걸지 말 것(프리미티브는 inline style로 렌더되어 className을 이긴다).

## @theme static인 이유

- 프리미티브는 토큰을 inline style의 `var(--color-…)`로 소비한다. Tailwind가 사용처를 스캔하지 못하므로, 정적으로 방출하지 않으면 tree-shake로 조용히 사라진다(빌드 에러 없이 무스타일).
- 그래서 `@theme static`으로 전부 방출한다. `theme.css`의 `@theme static` 블록을 제거·축소하지 말 것(드리프트 가드 테스트 + dist grep이 방어선).
- `--color-*: initial` 등으로 Tailwind 기본 팔레트·라운드·그림자를 지운다 → `bg-red-500` `rounded-md`는 아무 스타일도 내지 않는다.

## 다크모드 업그레이드 경로

- 현재 라이트 모드 전용. 팔레트와 시맨틱이 한 `@theme static` 블록에 있다.
- 도입 시: **시맨틱 섹션만** `:root`/`[data-theme="dark"]` 블록으로 분리하고 `@theme inline`으로 전환한다(팔레트는 그대로).
- 컴포넌트는 시맨틱만 참조하므로 호출부 변경 없음 — 이것이 2계층을 두는 실익이다.
