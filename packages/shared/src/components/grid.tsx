import type { CSSProperties, ElementType } from "react";

import {
  pickResponsive,
  type ResponsiveValue,
  useBreakpoint,
} from "../breakpoint";
import { Box, type BoxProps } from "./box";

export type GridProps<E extends ElementType = "div"> = BoxProps<E> & {
  /** 균등 n열 — repeat(n, minmax(0, 1fr)) */
  columns?: ResponsiveValue<number>;
  /** 비균등 템플릿 탈출구 — 예: "240px 1fr" */
  templateColumns?: string;
};

export function Grid<E extends ElementType = "div">(props: GridProps<E>) {
  const { columns, templateColumns, style, ...rest } = props;
  const bp = useBreakpoint();
  const n = columns === undefined ? undefined : pickResponsive(columns, bp);
  const gridTemplateColumns =
    templateColumns ??
    (n === undefined ? undefined : `repeat(${n}, minmax(0, 1fr))`);
  return (
    <Box
      display="grid"
      {...(rest as BoxProps<E>)}
      style={{ gridTemplateColumns, ...(style as CSSProperties) }}
    />
  );
}
