import type { ElementType } from "react";

import type { BoxStyleProps } from "../style-props";
import { Box, type BoxProps } from "./box";

export type FlexProps<E extends ElementType = "div"> = BoxProps<E> & {
  direction?: BoxStyleProps["flexDirection"];
  align?: BoxStyleProps["alignItems"];
  justify?: BoxStyleProps["justifyContent"];
  wrap?: BoxStyleProps["flexWrap"];
  grow?: BoxStyleProps["flexGrow"];
  shrink?: BoxStyleProps["flexShrink"];
};

export function Flex<E extends ElementType = "div">(props: FlexProps<E>) {
  const { direction, align, justify, wrap, grow, shrink, ...rest } = props;
  return (
    <Box
      display="flex"
      flexDirection={direction}
      alignItems={align}
      justifyContent={justify}
      flexWrap={wrap}
      flexGrow={grow}
      flexShrink={shrink}
      {...(rest as BoxProps<E>)}
    />
  );
}
