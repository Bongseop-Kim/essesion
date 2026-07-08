import type { CSSProperties, ElementType } from "react";

import {
  pickResponsive,
  type ResponsiveValue,
  useBreakpoint,
} from "../breakpoint";
import { resolveSpacing, type TokenSpacing } from "../style-props";
import { Box, type BoxProps } from "./box";

export type FloatPlacement =
  | "top-start"
  | "top-center"
  | "top-end"
  | "middle-start"
  | "middle-center"
  | "middle-end"
  | "bottom-start"
  | "bottom-center"
  | "bottom-end";

export type FloatProps<E extends ElementType = "div"> = BoxProps<E> & {
  /** 부모에 position="relative" 필요 */
  placement?: FloatPlacement;
  offsetX?: ResponsiveValue<TokenSpacing>;
  offsetY?: ResponsiveValue<TokenSpacing>;
};

export function Float<E extends ElementType = "div">(props: FloatProps<E>) {
  const {
    placement = "top-end",
    offsetX = 0,
    offsetY = 0,
    style,
    ...rest
  } = props;
  const bp = useBreakpoint();
  const ox = resolveSpacing(pickResponsive(offsetX, bp) ?? 0);
  const oy = resolveSpacing(pickResponsive(offsetY, bp) ?? 0);
  const [v, h] = placement.split("-") as [
    "top" | "middle" | "bottom",
    "start" | "center" | "end",
  ];

  const pos: CSSProperties = {};
  if (v === "middle") pos.top = "50%";
  else pos[v] = oy;
  if (h === "center") pos.left = "50%";
  else pos[h === "start" ? "left" : "right"] = ox;

  const translateX = h === "center" ? "-50%" : "0";
  const translateY = v === "middle" ? "-50%" : "0";
  const transform =
    translateX === "0" && translateY === "0"
      ? undefined
      : `translate(${translateX}, ${translateY})`;

  return (
    <Box
      position="absolute"
      {...(rest as BoxProps<E>)}
      style={{ ...pos, transform, ...(style as CSSProperties) }}
    />
  );
}
