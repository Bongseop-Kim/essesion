# 디자인 토큰 레퍼런스

전 토큰의 유일한 값 사전. 값은 `src/theme.css`와 1:1이며, 이 문서와 코드가 어긋나면 `theme.css`가 정답이다. 값을 창작하지 말 것.

표기: **토큰**은 프리미티브 prop 표기(`fg.neutral`), **CSS 변수**는 `theme.css` 선언, **Tailwind**는 유틸리티 클래스. prop↔Tailwind 대응 원리는 [design-token.md](./design-token.md).

## fg (전경 — 텍스트·아이콘)

| 토큰 | CSS 변수 | 값 | Tailwind |
|---|---|---|---|
| `fg.neutral` | `--color-fg-neutral` | gray-1000 `#1a1c20` | `text-fg-neutral` |
| `fg.neutral-muted` | `--color-fg-neutral-muted` | gray-800 `#555d6d` | `text-fg-neutral-muted` |
| `fg.neutral-subtle` | `--color-fg-neutral-subtle` | gray-700 `#868b94` | `text-fg-neutral-subtle` |
| `fg.brand` | `--color-fg-brand` | `#111111` | `text-fg-brand` |
| `fg.contrast` | `--color-fg-contrast` | `#ffffff` | `text-fg-contrast` |
| `fg.critical` | `--color-fg-critical` | red-800 `#ca1d13` | `text-fg-critical` |
| `fg.positive` | `--color-fg-positive` | green-800 `#00745f` | `text-fg-positive` |
| `fg.warning` | `--color-fg-warning` | yellow-800 `#755b22` | `text-fg-warning` |
| `fg.informative` | `--color-fg-informative` | blue-800 `#135fcd` | `text-fg-informative` |

## bg (배경 — 면)

| 토큰 | CSS 변수 | 값 | Tailwind |
|---|---|---|---|
| `bg.brand-solid` | `--color-bg-brand-solid` | `#111111` | `bg-bg-brand-solid` |
| `bg.brand-solid-hover` | `--color-bg-brand-solid-hover` | `#2b2b2b` | `bg-bg-brand-solid-hover` |
| `bg.brand-solid-pressed` | `--color-bg-brand-solid-pressed` | `#404040` | `bg-bg-brand-solid-pressed` |
| `bg.brand-weak` | `--color-bg-brand-weak` | gray-200 `#f3f4f5` | `bg-bg-brand-weak` |
| `bg.neutral-weak` | `--color-bg-neutral-weak` | gray-200 `#f3f4f5` | `bg-bg-neutral-weak` |
| `bg.neutral-weak-hover` | `--color-bg-neutral-weak-hover` | gray-300 `#eeeff1` | `bg-bg-neutral-weak-hover` |
| `bg.neutral-weak-pressed` | `--color-bg-neutral-weak-pressed` | gray-400 `#dcdee3` | `bg-bg-neutral-weak-pressed` |
| `bg.layer-basement` | `--color-bg-layer-basement` | gray-100 `#f7f8f9` | `bg-bg-layer-basement` |
| `bg.layer-default` | `--color-bg-layer-default` | `#ffffff` | `bg-bg-layer-default` |
| `bg.layer-floating` | `--color-bg-layer-floating` | `#ffffff` | `bg-bg-layer-floating` |
| `bg.critical-solid` | `--color-bg-critical-solid` | red-700 `#fa342c` | `bg-bg-critical-solid` |
| `bg.critical-solid-hover` | `--color-bg-critical-solid-hover` | red-800 `#ca1d13` | `bg-bg-critical-solid-hover` |
| `bg.critical-solid-pressed` | `--color-bg-critical-solid-pressed` | red-900 `#921708` | `bg-bg-critical-solid-pressed` |
| `bg.critical-weak` | `--color-bg-critical-weak` | red-100 `#fdf0f0` | `bg-bg-critical-weak` |
| `bg.positive-solid` | `--color-bg-positive-solid` | green-700 `#079171` | `bg-bg-positive-solid` |
| `bg.positive-solid-hover` | `--color-bg-positive-solid-hover` | green-800 `#00745f` | `bg-bg-positive-solid-hover` |
| `bg.positive-solid-pressed` | `--color-bg-positive-solid-pressed` | green-900 `#075445` | `bg-bg-positive-solid-pressed` |
| `bg.positive-weak` | `--color-bg-positive-weak` | green-100 `#edfaf6` | `bg-bg-positive-weak` |
| `bg.warning-weak` | `--color-bg-warning-weak` | yellow-100 `#fff7de` | `bg-bg-warning-weak` |
| `bg.informative-solid` | `--color-bg-informative-solid` | blue-700 `#217cf9` | `bg-bg-informative-solid` |
| `bg.informative-solid-hover` | `--color-bg-informative-solid-hover` | blue-800 `#135fcd` | `bg-bg-informative-solid-hover` |
| `bg.informative-solid-pressed` | `--color-bg-informative-solid-pressed` | blue-900 `#0b4596` | `bg-bg-informative-solid-pressed` |
| `bg.informative-weak` | `--color-bg-informative-weak` | blue-100 `#eff6ff` | `bg-bg-informative-weak` |

## stroke (선 — 테두리·구분선·포커스)

| 토큰 | CSS 변수 | 값 | Tailwind |
|---|---|---|---|
| `stroke.neutral` | `--color-stroke-neutral` | gray-400 `#dcdee3` | `border-stroke-neutral` |
| `stroke.neutral-weak` | `--color-stroke-neutral-weak` | gray-300 `#eeeff1` | `border-stroke-neutral-weak` |
| `stroke.brand` | `--color-stroke-brand` | `#111111` | `border-stroke-brand` |
| `stroke.focus-ring` | `--color-stroke-focus-ring` | blue-600 `#5e98fe` | `outline-stroke-focus-ring` |
| `stroke.critical` | `--color-stroke-critical` | red-700 `#fa342c` | `border-stroke-critical` |
| `stroke.positive` | `--color-stroke-positive` | green-700 `#079171` | `border-stroke-positive` |
| `stroke.warning` | `--color-stroke-warning` | yellow-700 `#9b7821` | `border-stroke-warning` |
| `stroke.informative` | `--color-stroke-informative` | blue-700 `#217cf9` | `border-stroke-informative` |

## 팔레트 (scale — 직접 사용 금지, 시맨틱의 재료)

CSS 변수는 `--color-palette-{ramp}-{step}`. 자세한 용도는 [palette.md](./palette.md).

| gray | 값 | red | green | yellow | blue |
|---|---|---|---|---|---|
| `gray-00` | `#ffffff` | `red-100` `#fdf0f0` | `green-100` `#edfaf6` | `yellow-100` `#fff7de` | `blue-100` `#eff6ff` |
| `gray-100` | `#f7f8f9` | `red-200` `#fde7e7` | `green-200` `#d9f6e9` | `yellow-200` `#fdefb9` | `blue-200` `#e2edfc` |
| `gray-200` | `#f3f4f5` | `red-300` `#fed4d2` | `green-300` `#b9e9d2` | `yellow-300` `#fbdc65` | `blue-300` `#cbdffa` |
| `gray-300` | `#eeeff1` | `red-700` `#fa342c` | `green-700` `#079171` | `yellow-700` `#9b7821` | `blue-600` `#5e98fe` |
| `gray-400` | `#dcdee3` | `red-800` `#ca1d13` | `green-800` `#00745f` | `yellow-800` `#755b22` | `blue-700` `#217cf9` |
| `gray-500` | `#d1d3d8` | `red-900` `#921708` | `green-900` `#075445` | `yellow-900` `#4f3e1f` | `blue-800` `#135fcd` |
| `gray-600` | `#b0b3ba` | | | | `blue-900` `#0b4596` |
| `gray-700` | `#868b94` | | | | |
| `gray-800` | `#555d6d` | | | | |
| `gray-900` | `#2a3038` | | | | |
| `gray-1000` | `#1a1c20` | | | | |

기타: `--color-white` `#ffffff`, `--color-black` `#000000`. blue는 포커스 링용 `blue-600`을 추가로 둔다(유채 램프 중 유일한 7단).

## 간격 x-스케일 (4px 그리드)

CSS 변수 `--spacing-{step}`, Tailwind `p-x4`·`gap-x4`처럼 접미로 사용. 용도는 [spacing.md](./spacing.md).

| 토큰 | 값 | | 토큰 | 값 | | 토큰 | 값 |
|---|---|---|---|---|---|---|---|
| `x0_5` | 2px | | `x3` | 12px | | `x7` | 28px |
| `x1` | 4px | | `x3_5` | 14px | | `x8` | 32px |
| `x1_5` | 6px | | `x4` | 16px | | `x9` | 36px |
| `x2` | 8px | | `x4_5` | 18px | | `x10` | 40px |
| `x2_5` | 10px | | `x5` | 20px | | `x12` | 48px |
| | | | `x6` | 24px | | `x13` | 52px |
| | | | | | | `x14` | 56px |
| | | | | | | `x16` | 64px |

## 라운드 r-스케일

CSS 변수 `--radius-{step}`, Tailwind `rounded-r2`. 용도는 [radius.md](./radius.md).

| 토큰 | 값 | 토큰 | 값 |
|---|---|---|---|
| `r0_5` | 2px | `r4` | 16px |
| `r1` | 4px | `r5` | 20px |
| `r1_5` | 6px | `r6` | 24px |
| `r2` | 8px | `full` | 9999px |
| `r3` | 12px | | |

## 그림자

CSS 변수 `--shadow-{step}`, Tailwind `shadow-s1`. 용도는 [elevation.md](./elevation.md).

| 토큰 | 값 | 용도 |
|---|---|---|
| `s1` | `0 1px 4px 0 rgb(0 0 0 / 0.08)` | 카드 |
| `s2` | `0 2px 10px 0 rgb(0 0 0 / 0.1)` | 드롭다운·팝오버 |
| `s3` | `0 4px 16px 0 rgb(0 0 0 / 0.12)` | 모달·다이얼로그 |

## 타이포 t-스케일

CSS 변수 `--text-{step}`(+ `--text-{step}--line-height`), Tailwind `text-t3`. 시맨틱 레시피는 [typography.md](./typography.md). t11·t13·t14는 컷.

| 토큰 | 크기 | 행간 | 토큰 | 크기 | 행간 |
|---|---|---|---|---|---|
| `t1` | 11px | 15px | `t7` | 20px | 27px |
| `t2` | 12px | 16px | `t8` | 22px | 30px |
| `t3` | 13px | 18px | `t9` | 24px | 32px |
| `t4` | 14px | 19px | `t10` | 26px | 35px |
| `t5` | 16px | 22px | `t12` | 32px | 42px |
| `t6` | 18px | 24px | | | |

## 브레이크포인트

CSS 변수 `--breakpoint-{key}`(값은 `src/breakpoint.ts`와 동기), Tailwind `md:` variant. 상세는 [layout.md](./layout.md).

| 토큰 | 값 | Tailwind |
|---|---|---|
| `sm` | 480px | `sm:` |
| `md` | 768px | `md:` |
| `lg` | 1280px | `lg:` |
| `xl` | 1440px | `xl:` |

## 이징·duration

이징은 `@theme`, duration은 `:root` 일반 변수(v4에 duration 네임스페이스가 없어 항상 방출). duration은 Tailwind 유틸리티가 생성되지 않으므로 `var(--duration-fast)`로 소비. 상세는 [motion.md](./motion.md).

| 토큰 | CSS 변수 | 값 |
|---|---|---|
| `standard` | `--ease-standard` | `cubic-bezier(0.35, 0, 0.35, 1)` |
| `enter` | `--ease-enter` | `cubic-bezier(0, 0, 0.15, 1)` |
| `exit` | `--ease-exit` | `cubic-bezier(0.35, 0, 1, 1)` |
| `fast` | `--duration-fast` | 100ms |
| `normal` | `--duration-normal` | 200ms |
| `slow` | `--duration-slow` | 300ms |
