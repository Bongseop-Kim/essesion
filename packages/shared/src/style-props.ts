import type { CSSProperties } from "react";

import {
  type Breakpoint,
  pickResponsive,
  type ResponsiveValue,
} from "./breakpoint";
import type {
  ColorToken,
  RadiusToken,
  ShadowToken,
  SpacingToken,
} from "./tokens";

/* ── 값 타입: 토큰 우선. (string & {})는 CSS 문자열 탈출구 —
   raw 숫자 금지 등 사용 규칙은 packages/shared/AGENTS.md가 강제 ── */
export type TokenColor = ColorToken | (string & {});
export type TokenSpacing = 0 | SpacingToken | (string & {});
export type TokenSize = number | SpacingToken | "full" | (string & {});
export type TokenRadius = 0 | RadiusToken | (string & {});
export type TokenShadow = ShadowToken | (string & {});

type Resp<T> = ResponsiveValue<T>;

type FlexAlign =
  | "flex-start"
  | "flex-end"
  | "start"
  | "end"
  | "center"
  | "baseline"
  | "stretch";
type FlexJustify =
  | "flex-start"
  | "flex-end"
  | "start"
  | "end"
  | "center"
  | "space-between"
  | "space-around"
  | "space-evenly";
type OverflowValue = "visible" | "hidden" | "auto" | "scroll";

export type BoxStyleProps = {
  display?: Resp<
    "none" | "block" | "inline-block" | "flex" | "inline-flex" | "grid"
  >;
  position?: Resp<"static" | "relative" | "absolute" | "fixed" | "sticky">;
  inset?: Resp<TokenSpacing>;
  top?: Resp<TokenSpacing>;
  right?: Resp<TokenSpacing>;
  bottom?: Resp<TokenSpacing>;
  left?: Resp<TokenSpacing>;
  overflow?: Resp<OverflowValue>;
  overflowX?: Resp<OverflowValue>;
  overflowY?: Resp<OverflowValue>;
  zIndex?: Resp<number>;

  width?: Resp<TokenSize>;
  minWidth?: Resp<TokenSize>;
  maxWidth?: Resp<TokenSize>;
  height?: Resp<TokenSize>;
  minHeight?: Resp<TokenSize>;
  maxHeight?: Resp<TokenSize>;

  p?: Resp<TokenSpacing>;
  px?: Resp<TokenSpacing>;
  py?: Resp<TokenSpacing>;
  pt?: Resp<TokenSpacing>;
  pr?: Resp<TokenSpacing>;
  pb?: Resp<TokenSpacing>;
  pl?: Resp<TokenSpacing>;
  m?: Resp<TokenSpacing | "auto">;
  mx?: Resp<TokenSpacing | "auto">;
  my?: Resp<TokenSpacing | "auto">;
  mt?: Resp<TokenSpacing | "auto">;
  mr?: Resp<TokenSpacing | "auto">;
  mb?: Resp<TokenSpacing | "auto">;
  ml?: Resp<TokenSpacing | "auto">;
  gap?: Resp<TokenSpacing>;
  rowGap?: Resp<TokenSpacing>;
  columnGap?: Resp<TokenSpacing>;

  bg?: Resp<TokenColor>;
  borderColor?: Resp<TokenColor>;
  /** 구조값 — 설정 시 border-style: solid 자동 적용 */
  borderWidth?: Resp<number>;
  borderRadius?: Resp<TokenRadius>;
  boxShadow?: Resp<TokenShadow>;

  flex?: Resp<number | string>;
  flexGrow?: Resp<true | number>;
  flexShrink?: Resp<true | number>;
  flexDirection?: Resp<"row" | "row-reverse" | "column" | "column-reverse">;
  flexWrap?: Resp<true | "wrap" | "nowrap" | "wrap-reverse">;
  justifyContent?: Resp<FlexJustify>;
  alignItems?: Resp<FlexAlign>;
  alignSelf?: Resp<FlexAlign | "auto">;

  /** 숫자 n → `span n / span n` (Tailwind col-span과 동일 의미), 문자열은 통과 */
  gridColumn?: Resp<number | string>;
  gridRow?: Resp<number | string>;
};

/* ── 리졸버: 순수 문자열 변환. 토큰 패턴이 아니면 raw 통과("transparent", "auto", "50%") ── */

const COLOR_RE = /^(?:fg|bg|stroke|palette)\./;
export function resolveColor(value: TokenColor): string {
  return COLOR_RE.test(value)
    ? `var(--color-${value.replace(".", "-")})`
    : value;
}

const SPACING_RE = /^x\d+(?:_5)?$/;
export function resolveSpacing(value: TokenSpacing | "auto"): string | number {
  return typeof value === "string" && SPACING_RE.test(value)
    ? `var(--spacing-${value})`
    : value;
}

export function resolveSize(value: TokenSize): string | number {
  if (value === "full") return "100%";
  return typeof value === "string" ? resolveSpacing(value) : value;
}

const RADIUS_RE = /^(?:r\d+(?:_5)?|full)$/;
export function resolveRadius(value: TokenRadius): string | number {
  return typeof value === "string" && RADIUS_RE.test(value)
    ? `var(--radius-${value})`
    : value;
}

const SHADOW_RE = /^s[123]$/;
export function resolveShadow(value: TokenShadow): string {
  return SHADOW_RE.test(value) ? `var(--shadow-${value})` : value;
}

/* ── prop → CSS 속성 매핑. "선언 순서 = 우선순위": 단축형(p) 먼저,
   세부형(pt)이 나중에 덮어쓴다. 리졸버는 kind로 선택. ── */

type Kind =
  | "raw"
  | "color"
  | "spacing"
  | "size"
  | "radius"
  | "shadow"
  | "borderWidth"
  | "grow"
  | "wrap"
  | "gridSpan";

const DEFS: [prop: string, css: string[], kind: Kind][] = [
  ["display", ["display"], "raw"],
  ["position", ["position"], "raw"],
  ["inset", ["top", "right", "bottom", "left"], "spacing"],
  ["top", ["top"], "spacing"],
  ["right", ["right"], "spacing"],
  ["bottom", ["bottom"], "spacing"],
  ["left", ["left"], "spacing"],
  ["overflow", ["overflow"], "raw"],
  ["overflowX", ["overflowX"], "raw"],
  ["overflowY", ["overflowY"], "raw"],
  ["zIndex", ["zIndex"], "raw"],
  ["width", ["width"], "size"],
  ["minWidth", ["minWidth"], "size"],
  ["maxWidth", ["maxWidth"], "size"],
  ["height", ["height"], "size"],
  ["minHeight", ["minHeight"], "size"],
  ["maxHeight", ["maxHeight"], "size"],
  [
    "p",
    ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"],
    "spacing",
  ],
  ["px", ["paddingLeft", "paddingRight"], "spacing"],
  ["py", ["paddingTop", "paddingBottom"], "spacing"],
  ["pt", ["paddingTop"], "spacing"],
  ["pr", ["paddingRight"], "spacing"],
  ["pb", ["paddingBottom"], "spacing"],
  ["pl", ["paddingLeft"], "spacing"],
  ["m", ["marginTop", "marginRight", "marginBottom", "marginLeft"], "spacing"],
  ["mx", ["marginLeft", "marginRight"], "spacing"],
  ["my", ["marginTop", "marginBottom"], "spacing"],
  ["mt", ["marginTop"], "spacing"],
  ["mr", ["marginRight"], "spacing"],
  ["mb", ["marginBottom"], "spacing"],
  ["ml", ["marginLeft"], "spacing"],
  ["gap", ["gap"], "spacing"],
  ["rowGap", ["rowGap"], "spacing"],
  ["columnGap", ["columnGap"], "spacing"],
  ["bg", ["backgroundColor"], "color"],
  ["borderColor", ["borderColor"], "color"],
  ["borderWidth", ["borderWidth"], "borderWidth"],
  ["borderRadius", ["borderRadius"], "radius"],
  ["boxShadow", ["boxShadow"], "shadow"],
  ["flex", ["flex"], "raw"],
  ["flexGrow", ["flexGrow"], "grow"],
  ["flexShrink", ["flexShrink"], "grow"],
  ["flexDirection", ["flexDirection"], "raw"],
  ["flexWrap", ["flexWrap"], "wrap"],
  ["justifyContent", ["justifyContent"], "raw"],
  ["alignItems", ["alignItems"], "raw"],
  ["alignSelf", ["alignSelf"], "raw"],
  ["gridColumn", ["gridColumn"], "gridSpan"],
  ["gridRow", ["gridRow"], "gridSpan"],
];

const RESOLVERS: Record<Kind, (v: unknown) => string | number> = {
  raw: (v) => v as string | number,
  color: (v) => resolveColor(v as TokenColor),
  spacing: (v) => resolveSpacing(v as TokenSpacing),
  size: (v) => resolveSize(v as TokenSize),
  radius: (v) => resolveRadius(v as TokenRadius),
  shadow: (v) => resolveShadow(v as TokenShadow),
  borderWidth: (v) => v as number,
  grow: (v) => (v === true ? 1 : (v as number)),
  wrap: (v) => (v === true ? "wrap" : (v as string)),
  gridSpan: (v) =>
    typeof v === "number" ? `span ${v} / span ${v}` : (v as string),
};

const STYLE_PROP_NAMES = new Set(DEFS.map(([prop]) => prop));

/** style prop과 DOM prop 분리 — className/style/ref/이벤트/aria는 elementProps로. */
export function splitStyleProps<P extends object>(
  props: P,
): { styleProps: BoxStyleProps; elementProps: Omit<P, keyof BoxStyleProps> } {
  const styleProps: Record<string, unknown> = {};
  const elementProps: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    (STYLE_PROP_NAMES.has(key) ? styleProps : elementProps)[key] = value;
  }
  return {
    styleProps: styleProps as BoxStyleProps,
    elementProps: elementProps as Omit<P, keyof BoxStyleProps>,
  };
}

/** 반응형 pre-pass → 별칭 전개 → 토큰 해석. (props, bp)의 순수 함수. */
export function resolveBoxStyle(
  props: BoxStyleProps,
  bp: Breakpoint,
): CSSProperties {
  const style: Record<string, string | number> = {};
  const bag = props as Record<string, unknown>;
  for (const [prop, cssProps, kind] of DEFS) {
    const raw = bag[prop];
    if (raw === undefined) continue;
    const picked = pickResponsive(raw as ResponsiveValue<unknown>, bp);
    if (picked === undefined) continue;
    const resolved = RESOLVERS[kind](picked);
    for (const cssProp of cssProps) {
      style[cssProp] = resolved;
    }
    if (kind === "borderWidth") style.borderStyle = "solid";
  }
  return style as CSSProperties;
}
