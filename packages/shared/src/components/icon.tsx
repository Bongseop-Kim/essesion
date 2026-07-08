import type { ComponentPropsWithRef, ReactElement } from "react";

import {
  pickResponsive,
  type ResponsiveValue,
  useBreakpoint,
} from "../breakpoint";
import { cn } from "../cn";
import { resolveColor, resolveSize, type TokenColor } from "../style-props";
import type { SpacingToken } from "../tokens";

export type IconProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  /** 아이콘 에셋은 앱이 소유(@heroicons/react 등) — `<Icon svg={<XMarkIcon />} />` */
  svg: ReactElement;
  /** 숫자는 px, x* 값은 spacing token — 16(인라인)/20(버튼)/24(기본). */
  size?: ResponsiveValue<number | SpacingToken>;
  /** 기본: currentColor 상속 */
  color?: ResponsiveValue<TokenColor>;
};

export function Icon(props: IconProps) {
  const {
    svg,
    size = 24,
    color,
    className,
    style,
    "aria-label": ariaLabel,
    ...rest
  } = props;
  const bp = useBreakpoint();
  const side = pickResponsive(size, bp) ?? 24;
  const picked = color === undefined ? undefined : pickResponsive(color, bp);
  const resolvedSide = resolveSize(side);

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("inline-flex shrink-0 [&>svg]:size-full", className)}
      style={{
        width: resolvedSide,
        height: resolvedSide,
        color: picked === undefined ? undefined : resolveColor(picked),
        ...style,
      }}
      {...rest}
    >
      {svg}
    </span>
  );
}
