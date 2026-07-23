export type AnchoredPlacement = "top" | "bottom";

export type FloatingRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type FloatingSize = { width: number; height: number };

export type AnchoredPosition = {
  placement: AnchoredPlacement;
  side: AnchoredPlacement;
  top: number;
  left: number;
  arrowX?: number;
};

export type AnchoredPositionOptions = {
  placement: AnchoredPlacement;
  gutter: number;
  overflowPadding: number;
  arrow?: { width: number; height: number; padding: number };
};

export function positionAnchored(
  reference: FloatingRect,
  floating: FloatingSize,
  viewport: FloatingSize,
  options: AnchoredPositionOptions,
): AnchoredPosition {
  const gap = options.gutter + (options.arrow?.height ?? 0);
  const opposite = options.placement === "top" ? "bottom" : "top";
  const positions = ([options.placement, opposite] as AnchoredPlacement[]).map(
    (placement) => ({
      placement,
      top:
        placement === "top"
          ? reference.top - gap - floating.height
          : reference.bottom + gap,
      left: reference.left + (reference.width - floating.width) / 2,
    }),
  );
  const selected =
    positions.find(
      (position) =>
        position.top >= options.overflowPadding &&
        position.top + floating.height + options.overflowPadding <=
          viewport.height,
    ) ?? positions[0]!;
  const left = clamp(
    selected.left,
    options.overflowPadding,
    viewport.width - options.overflowPadding - floating.width,
  );
  const top = clamp(
    selected.top,
    options.overflowPadding,
    viewport.height - options.overflowPadding - floating.height,
  );

  if (!options.arrow) {
    return {
      placement: selected.placement,
      side: selected.placement,
      top,
      left,
    };
  }

  return {
    placement: selected.placement,
    side: selected.placement,
    top,
    left,
    arrowX: clamp(
      reference.left + reference.width / 2 - left - options.arrow.width / 2,
      options.arrow.padding,
      floating.width - options.arrow.padding - options.arrow.width,
    ),
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
