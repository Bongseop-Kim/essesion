# 타이포그래피

폰트·t-스케일·textStyle 레시피. 임의 `text-[13px]`·fontSize 스타일 금지 — 크기는 t-스케일, 시맨틱은 `Text` + `textStyle`만. 값은 [design-token-reference.md](./design-token-reference.md).

## 폰트

- **Pretendard Variable** (CDN dynamic subset). 각 앱 `index.css` **첫 줄**의 `@import`가 `@font-face`를 제공한다.
- `--font-sans: "Pretendard Variable", Pretendard, system-ui, -apple-system, sans-serif` — `html`에 적용됨.

## t-스케일

크기·행간의 원천. 본문은 `t1`~`t5`, 제목은 `t6`~`t12` 범위. t11·t13·t14는 컷.

| 토큰 | px | 행간 | 토큰 | px | 행간 |
|---|---|---|---|---|---|
| `t1` | 11 | 15 | `t7` | 20 | 27 |
| `t2` | 12 | 16 | `t8` | 22 | 30 |
| `t3` | 13 | 18 | `t9` | 24 | 32 |
| `t4` | 14 | 19 | `t10` | 26 | 35 |
| `t5` | 16 | 22 | `t12` | 32 | 42 |
| `t6` | 18 | 24 | | | |

## textStyle 10종

`Text`가 제공하는 시맨틱 레시피(`src/components/text.tsx`와 일치). 앱은 크기(t)를 직접 고르지 않고 이 이름을 쓴다.

| textStyle | step | 굵기 | 크기/행간 | 용도 |
|---|---|---|---|---|
| `display1` | t12 | 700 | 32/42 | store 히어로 |
| `title1` | t10 | 700 | 26/35 | 페이지 제목 |
| `title2` | t8 | 700 | 22/30 | 섹션 제목 |
| `title3` | t6 | 700 | 18/24 | 카드 제목 |
| `body` | t5 | 400 | 16/22 | store 기본 본문 |
| `bodySm` | t4 | 400 | 14/19 | admin 기본·테이블 |
| `label` | t5 | 500 | 16/22 | 버튼·폼 레이블 |
| `labelSm` | t4 | 500 | 14/19 | 작은 레이블 |
| `caption` | t3 | 400 | 13/18 | 보조 텍스트 |
| `captionSm` | t2 | 400 | 12/16 | 뱃지·타임스탬프 |

- **store 기본 본문 = `body`, admin 기본 본문 = `bodySm`** (admin은 정보 밀도 우선). → [layout.md](./layout.md)
- `Text`의 기본 `textStyle`은 `body`.

## 시각 스타일 ↔ heading 레벨 분리

- `textStyle`은 "어떻게 보이나"만 정한다. 문서 구조(heading 레벨)는 `as`로 분리한다.
- 예: `<Text as="h1" textStyle="title1">` — h1의 시맨틱을 갖되 크기는 title1.
- 시각적 크기 때문에 잘못된 heading 레벨을 고르지 말 것(접근성·SEO). → [inclusive-design.md](./inclusive-design.md)

## 규칙

- 크기는 반드시 textStyle 경유. `text-[15px]`·인라인 `fontSize` 금지.
- 굵기는 레시피가 정한다(임의 `font-bold` 지양). 필요한 강조는 상위 textStyle로.
- 한 줄 말줄임은 `maxLines` prop 사용.
