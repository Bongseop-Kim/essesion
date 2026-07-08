import type { ComponentPropsWithRef, ReactNode } from "react";

import { cn } from "../cn";
import { ChevronDownGlyph, XGlyph } from "./internal/glyphs";

type Tone = "neutral" | "informative" | "positive" | "warning" | "critical";

// weak 면(bg.*-weak) — color-role.md: weak 면 위 텍스트는 해당 role의 fg.*.
const toneBg: Record<Tone, string> = {
  neutral: "bg-bg-neutral-weak",
  informative: "bg-bg-informative-weak",
  positive: "bg-bg-positive-weak",
  warning: "bg-bg-warning-weak",
  critical: "bg-bg-critical-weak",
};

// 본문(description·icon) 색 — neutral만 muted로 낮추고 나머지는 tone fg 유지.
const toneBody: Record<Tone, string> = {
  neutral: "text-fg-neutral-muted",
  informative: "text-fg-informative",
  positive: "text-fg-positive",
  warning: "text-fg-warning",
  critical: "text-fg-critical",
};

// 제목 색 — neutral만 강한 fg.neutral, 나머지는 tone fg.
const toneTitle: Record<Tone, string> = {
  neutral: "text-fg-neutral",
  informative: "text-fg-informative",
  positive: "text-fg-positive",
  warning: "text-fg-warning",
  critical: "text-fg-critical",
};

export type CalloutProps = Omit<
  ComponentPropsWithRef<"div">,
  "title" | "onClick"
> & {
  tone?: Tone;
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** actionable — 루트를 button으로 렌더하고 우측에 셰브론을 둔다. */
  onClick?: () => void;
  /** dismissible — 우측에 X 버튼을 둔다. onClick과 동시 사용 시 onClick 우선. */
  onDismiss?: () => void;
};

/** 페이지 내 안내 블록 — tone 5종, actionable(onClick)·dismissible(onDismiss) 지원. */
export function Callout({
  tone = "neutral",
  title,
  description,
  icon,
  onClick,
  onDismiss,
  className,
  children,
  ...rest
}: CalloutProps) {
  const actionable = onClick !== undefined;
  const dismissible = onDismiss !== undefined;
  if (process.env.NODE_ENV !== "production" && actionable && dismissible) {
    console.warn(
      "Callout: onClick과 onDismiss를 함께 지정하면 onClick(actionable)이 우선합니다.",
    );
  }

  const rootClass = cn(
    "flex min-h-12.5 w-full items-start gap-x3 rounded-r3 px-x3_5 py-x3_5 text-left text-t4",
    toneBg[tone],
    toneBody[tone],
    actionable &&
      "transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-80",
    className,
  );

  const inner = (
    <>
      {icon !== undefined && (
        // size-4(16px) 아이콘 권장 — 앱 소유 Icon/@heroicons을 슬롯으로 전달.
        <span className="shrink-0" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-x0_5">
        {title !== undefined && (
          <span className={cn("font-bold", toneTitle[tone])}>{title}</span>
        )}
        {description !== undefined && <span>{description}</span>}
        {children}
      </span>
      {actionable ? (
        <ChevronDownGlyph className="size-4 shrink-0 -rotate-90" />
      ) : dismissible ? (
        <button
          type="button"
          aria-label="닫기"
          onClick={onDismiss}
          className="flex size-6 shrink-0 items-center justify-center rounded-full transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring active:opacity-70"
        >
          <XGlyph className="size-4" />
        </button>
      ) : null}
    </>
  );

  if (actionable) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={rootClass}
        {...(rest as ComponentPropsWithRef<"button">)}
      >
        {inner}
      </button>
    );
  }
  return (
    <div className={rootClass} {...rest}>
      {inner}
    </div>
  );
}
