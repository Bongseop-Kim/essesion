import type { ComponentPropsWithRef, ReactElement } from "react";

import {
  pickResponsive,
  type ResponsiveValue,
  useBreakpoint,
} from "../breakpoint";
import { cn } from "../cn";
import { resolveColor, type TokenColor } from "../style-props";

export type IconProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  /** 아이콘 에셋은 앱이 소유(@heroicons/react 등) — `<Icon svg={<XMarkIcon />} />` */
  svg: ReactElement;
  /** px. 구조값이라 숫자 허용 — 16(인라인)/20(버튼)/24(기본) */
  size?: ResponsiveValue<number>;
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

  return (
    <span
      role="img"
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("inline-flex shrink-0 [&>svg]:size-full", className)}
      style={{
        width: side,
        height: side,
        color: picked === undefined ? undefined : resolveColor(picked),
        ...style,
      }}
      {...rest}
    >
      {svg}
    </span>
  );
}
