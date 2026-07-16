import { useId } from "react";

import { cn } from "../cn";

const VALUES = [1, 2, 3, 4, 5] as const;

type RatingProps = {
  value: number;
  "aria-label"?: string;
  className?: string;
  name?: string;
  disabled?: boolean;
  onChange?: (value: number) => void;
};

function Star({ fill }: { fill: number }) {
  return (
    <span
      aria-hidden
      className="relative block size-5 text-fg-neutral-subtle"
      data-fill={fill}
    >
      <StarSvg />
      {fill > 0 ? (
        <span
          className="absolute inset-y-0 left-0 overflow-hidden text-fg-brand"
          style={{ width: `${fill * 100}%` }}
        >
          <StarSvg className="max-w-none" />
        </span>
      ) : null}
    </span>
  );
}

function StarSvg({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("size-5", className)}
    >
      <path d="M12 2.75l2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 16.94l-5.56 2.93 1.06-6.2L3 9.28l6.22-.9L12 2.75z" />
    </svg>
  );
}

export function Rating({
  value,
  onChange,
  name,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: RatingProps) {
  const fallbackName = useId();
  const rounded = Math.max(0, Math.min(5, Math.round(value * 2) / 2));

  if (onChange === undefined) {
    return (
      <span
        role="img"
        aria-label={ariaLabel ?? `5점 만점에 ${rounded}점`}
        className={cn("inline-flex gap-x0_5", className)}
      >
        {VALUES.map((star) => (
          <Star
            key={star}
            fill={Math.max(0, Math.min(1, rounded - star + 1))}
          />
        ))}
      </span>
    );
  }

  return (
    <span
      role="radiogroup"
      aria-label={ariaLabel ?? "별점"}
      className={cn("inline-flex gap-x0_5", className)}
    >
      {VALUES.map((star) => (
        <label key={star} className={cn(!disabled && "cursor-pointer")}>
          <input
            type="radio"
            className="peer sr-only"
            name={name ?? fallbackName}
            value={star}
            checked={value === star}
            disabled={disabled}
            aria-label={`${star}점`}
            onChange={() => onChange(star)}
          />
          <span className="block rounded-r1 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring peer-disabled:opacity-50">
            <Star fill={value >= star ? 1 : 0} />
          </span>
        </label>
      ))}
    </span>
  );
}

export type { RatingProps };
