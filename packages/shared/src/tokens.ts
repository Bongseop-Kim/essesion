/* 토큰 "이름"의 단일 원본 — 값은 theme.css에만 둔다.
   const 배열인 이유: 드리프트 가드 테스트가 런타임에 열거해 theme.css 선언과 대조. */

export const fgRoles = [
  "neutral",
  "neutral-muted",
  "neutral-subtle",
  "placeholder",
  "disabled",
  "brand",
  "contrast",
  "critical",
  "positive",
  "warning",
  "informative",
] as const;

export const bgRoles = [
  "brand-solid",
  "brand-solid-hover",
  "brand-solid-pressed",
  "brand-weak",
  "neutral-weak",
  "neutral-weak-hover",
  "neutral-weak-pressed",
  "neutral-solid",
  "neutral-inverted",
  "disabled",
  "shimmer-highlight",
  "layer-basement",
  "layer-default",
  "layer-floating",
  "overlay",
  "image-scrim",
  "critical-solid",
  "critical-solid-hover",
  "critical-solid-pressed",
  "critical-weak",
  "positive-solid",
  "positive-solid-hover",
  "positive-solid-pressed",
  "positive-weak",
  "warning-weak",
  "informative-solid",
  "informative-solid-hover",
  "informative-solid-pressed",
  "informative-weak",
  // brand-login (OAuth) — 소셜 로그인 버튼 전용 브랜드색 (모노크롬 예외)
  "kakao",
  "kakao-hover",
  "kakao-pressed",
  "naver",
  "naver-hover",
  "naver-pressed",
] as const;

export const strokeRoles = [
  "neutral",
  "neutral-weak",
  "brand",
  "focus-ring",
  "critical",
  "positive",
  "warning",
  "informative",
] as const;

export const spacingSteps = [
  "x0_5",
  "x1",
  "x1_5",
  "x2",
  "x2_5",
  "x3",
  "x3_5",
  "x4",
  "x4_5",
  "x5",
  "x6",
  "x7",
  "x8",
  "x9",
  "x10",
  "x12",
  "x13",
  "x14",
  "x16",
] as const;

export const radiusSteps = [
  "r0_5",
  "r1",
  "r1_5",
  "r2",
  "r3",
  "r4",
  "r5",
  "r6",
  "full",
] as const;

export const shadowSteps = ["s1", "s2", "s3"] as const;

export const textSteps = [
  "t1",
  "t2",
  "t3",
  "t4",
  "t5",
  "t6",
  "t7",
  "t8",
  "t9",
  "t10",
  "t12",
] as const;

export const sizeRoles = [
  "field-narrow",
  "content-scroll",
  "loading-media",
  "loading-result",
  "modal-max-height",
] as const;

export const zLayers = ["sticky"] as const;

export type FgRole = (typeof fgRoles)[number];
export type BgRole = (typeof bgRoles)[number];
export type StrokeRole = (typeof strokeRoles)[number];
export type SpacingToken = (typeof spacingSteps)[number];
export type RadiusToken = (typeof radiusSteps)[number];
export type ShadowToken = (typeof shadowSteps)[number];
export type TextStep = (typeof textSteps)[number];
export type SizeRole = (typeof sizeRoles)[number];
export type ZLayer = (typeof zLayers)[number];
export type SizeToken = `size.${SizeRole}`;
export type ZIndexToken = `z.${ZLayer}`;

/** `fg.neutral` · `bg.brand-solid` · `stroke.focus-ring` · `palette.gray-100`(직접 사용 금지) */
export type ColorToken =
  | `fg.${FgRole}`
  | `bg.${BgRole}`
  | `stroke.${StrokeRole}`
  | `palette.${string}`;
