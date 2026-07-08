import type { ComponentPropsWithRef, CSSProperties, ElementType } from "react";

import { useBreakpoint } from "../breakpoint";
import {
  type BoxStyleProps,
  resolveBoxStyle,
  splitStyleProps,
} from "../style-props";

export type BoxProps<E extends ElementType = "div"> = BoxStyleProps & {
  as?: E;
} & Omit<ComponentPropsWithRef<E>, keyof BoxStyleProps | "as">;

/** 레이아웃 프리미티브의 기반 — style prop을 토큰 var()로 해석해 inline style로 렌더. */
export function Box<E extends ElementType = "div">(props: BoxProps<E>) {
  const bp = useBreakpoint();
  const { as, ...rest } = props;
  const { styleProps, elementProps } = splitStyleProps(rest);
  const { style, ...domProps } = elementProps as {
    style?: CSSProperties;
  } & Record<string, unknown>;
  const Comp = (as ?? "div") as ElementType;
  return (
    <Comp
      {...domProps}
      style={{ ...resolveBoxStyle(styleProps, bp), ...style }}
    />
  );
}
