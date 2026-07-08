import type { ElementType } from "react";

import { Flex, type FlexProps } from "./flex";

export type StackProps<E extends ElementType = "div"> = Omit<
  FlexProps<E>,
  "direction" | "flexDirection"
>;

/** 가로 배치 — 기본 align="center" (텍스트·아이콘 혼합 행의 관례). */
export function HStack<E extends ElementType = "div">(props: StackProps<E>) {
  return <Flex direction="row" align="center" {...(props as FlexProps<E>)} />;
}

/** 세로 배치. */
export function VStack<E extends ElementType = "div">(props: StackProps<E>) {
  return <Flex direction="column" {...(props as FlexProps<E>)} />;
}
