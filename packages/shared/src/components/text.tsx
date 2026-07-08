import type { CSSProperties, ElementType } from "react";

import {
  pickResponsive,
  type ResponsiveValue,
  useBreakpoint,
} from "../breakpoint";
import { resolveColor, type TokenColor } from "../style-props";
import type { TextStep } from "../tokens";
import { Box, type BoxProps } from "./box";

/* 시맨틱 레시피만 제공 — 시각 스타일과 heading 레벨은 as로 분리 (typography.md) */
const textStyles = {
  display1: { step: "t12", weight: 700 },
  title1: { step: "t10", weight: 700 },
  title2: { step: "t8", weight: 700 },
  title3: { step: "t6", weight: 700 },
  body: { step: "t5", weight: 400 },
  bodySm: { step: "t4", weight: 400 },
  label: { step: "t5", weight: 500 },
  labelSm: { step: "t4", weight: 500 },
  caption: { step: "t3", weight: 400 },
  captionSm: { step: "t2", weight: 400 },
} satisfies Record<string, { step: TextStep; weight: number }>;

export type TextStyleName = keyof typeof textStyles;

export type TextProps<E extends ElementType = "span"> = BoxProps<E> & {
  textStyle?: ResponsiveValue<TextStyleName>;
  color?: ResponsiveValue<TokenColor>;
  align?: ResponsiveValue<"start" | "center" | "end">;
  /** n줄 말줄임 (line-clamp) */
  maxLines?: number;
};

export function Text<E extends ElementType = "span">(props: TextProps<E>) {
  const {
    as,
    textStyle = "body",
    color,
    align,
    maxLines,
    style,
    ...rest
  } = props;
  const bp = useBreakpoint();
  const recipe = textStyles[pickResponsive(textStyle, bp) ?? "body"];
  const picked = color === undefined ? undefined : pickResponsive(color, bp);

  const clamp: CSSProperties =
    maxLines === undefined
      ? {}
      : {
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: maxLines,
          overflow: "hidden",
        };

  return (
    <Box
      as={(as ?? "span") as ElementType}
      {...(rest as BoxProps<ElementType>)}
      style={{
        fontSize: `var(--text-${recipe.step})`,
        lineHeight: `var(--text-${recipe.step}--line-height)`,
        fontWeight: recipe.weight,
        color: picked === undefined ? undefined : resolveColor(picked),
        textAlign: align === undefined ? undefined : pickResponsive(align, bp),
        ...clamp,
        ...(style as CSSProperties),
      }}
    />
  );
}
