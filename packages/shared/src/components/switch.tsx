import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";

const trackSizes = {
  medium: "w-9.5 h-6",
  large: "w-13 h-8",
};

const thumbSizes = {
  medium: "size-5",
  large: "size-7",
};

// 이동량 = 트랙폭 − 썸 − 좌우 인셋(각 2px). medium 38−20−4=14, large 52−28−4=20.
const thumbTravel = {
  medium: "peer-checked:translate-x-3.5",
  large: "peer-checked:translate-x-5",
};

const labelSizes = {
  medium: "text-t4",
  large: "text-t5",
};

export type SwitchProps = Omit<
  ComponentPropsWithRef<"input">,
  "size" | "type" | "role"
> & {
  size?: keyof typeof trackSizes;
  label?: ReactNode;
};

export function Switch({
  size = "medium",
  label,
  className,
  disabled,
  ref,
  ...props
}: SwitchProps) {
  // 트랙·썸 모두 input의 후속 형제로 두어 peer-* 가 닿게 하고, 썸은 label(relative) 기준 절대배치.
  return (
    <label
      className={cn("relative inline-flex items-center gap-x2", className)}
    >
      <input
        type="checkbox"
        // biome-ignore lint/a11y/useAriaPropsForRole: 네이티브 checkbox의 checked가 접근성 트리에서 switch의 checked 상태로 노출됨(uncontrolled 가능하므로 정적 aria-checked는 부적절)
        role="switch"
        ref={ref}
        disabled={disabled}
        className="peer sr-only"
        {...props}
      />
      <span
        aria-hidden
        className={cn(
          "shrink-0 rounded-full bg-bg-neutral-solid transition-colors duration-200 ease-standard",
          "peer-checked:bg-bg-brand-solid peer-disabled:bg-bg-disabled",
          "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring",
          trackSizes[size],
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute top-1/2 left-0.5 -translate-y-1/2 rounded-full bg-white shadow-s1 transition-transform duration-200 ease-standard",
          thumbSizes[size],
          thumbTravel[size],
        )}
      />
      {label != null && (
        <span
          className={cn(
            "font-medium select-none text-fg-neutral peer-disabled:text-fg-disabled",
            labelSizes[size],
          )}
        >
          {label}
        </span>
      )}
    </label>
  );
}
