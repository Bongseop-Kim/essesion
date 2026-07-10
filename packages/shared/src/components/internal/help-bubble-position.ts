export type HelpBubbleSide = "top" | "right" | "bottom" | "left";
export type HelpBubbleAlignment = "start" | "end";
export type HelpBubblePlacement =
  | HelpBubbleSide
  | `${HelpBubbleSide}-${HelpBubbleAlignment}`;

export type FloatingRect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

export type FloatingSize = { width: number; height: number };

export type HelpBubblePosition = {
  placement: HelpBubblePlacement;
  side: HelpBubbleSide;
  top: number;
  left: number;
  arrowX?: number;
  arrowY?: number;
};

export type HelpBubblePositionOptions = {
  placement: HelpBubblePlacement;
  gutter: number;
  overflowPadding: number;
  arrowPadding: number;
  flip: boolean | HelpBubblePlacement[];
  slide: boolean;
};

export const HELP_BUBBLE_ARROW_WIDTH = 12;
export const HELP_BUBBLE_ARROW_HEIGHT = 8;

const oppositeSide: Record<HelpBubbleSide, HelpBubbleSide> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

export function positionHelpBubble(
  reference: FloatingRect,
  floating: FloatingSize,
  viewport: FloatingSize,
  options: HelpBubblePositionOptions,
): HelpBubblePosition {
  const candidates = placementCandidates(options.placement, options.flip);
  const gap = options.gutter + HELP_BUBBLE_ARROW_HEIGHT;
  const positioned = candidates.map((placement) => ({
    placement,
    ...basePosition(reference, floating, placement, gap),
  }));
  const selected =
    positioned.find(
      (position) =>
        overflowScore(position, floating, viewport, options.overflowPadding) ===
        0,
    ) ??
    positioned.reduce((best, candidate) =>
      overflowScore(candidate, floating, viewport, options.overflowPadding) <
      overflowScore(best, floating, viewport, options.overflowPadding)
        ? candidate
        : best,
    );

  const left = options.slide
    ? clamp(
        selected.left,
        options.overflowPadding,
        viewport.width - options.overflowPadding - floating.width,
      )
    : selected.left;
  const top = options.slide
    ? clamp(
        selected.top,
        options.overflowPadding,
        viewport.height - options.overflowPadding - floating.height,
      )
    : selected.top;
  const [side] = splitPlacement(selected.placement);

  if (side === "top" || side === "bottom") {
    const arrowX = clamp(
      reference.left + reference.width / 2 - left - HELP_BUBBLE_ARROW_WIDTH / 2,
      options.arrowPadding,
      floating.width - options.arrowPadding - HELP_BUBBLE_ARROW_WIDTH,
    );
    return { placement: selected.placement, side, top, left, arrowX };
  }

  const arrowY = clamp(
    reference.top + reference.height / 2 - top - HELP_BUBBLE_ARROW_WIDTH / 2,
    options.arrowPadding,
    floating.height - options.arrowPadding - HELP_BUBBLE_ARROW_WIDTH,
  );
  return { placement: selected.placement, side, top, left, arrowY };
}

function placementCandidates(
  placement: HelpBubblePlacement,
  flip: boolean | HelpBubblePlacement[],
) {
  if (Array.isArray(flip)) return unique([placement, ...flip]);
  if (!flip) return [placement];
  const [side, alignment] = splitPlacement(placement);
  const opposite = `${oppositeSide[side]}${alignment ? `-${alignment}` : ""}`;
  return [placement, opposite as HelpBubblePlacement];
}

function splitPlacement(
  placement: HelpBubblePlacement,
): [HelpBubbleSide, HelpBubbleAlignment | undefined] {
  const [side, alignment] = placement.split("-") as [
    HelpBubbleSide,
    HelpBubbleAlignment | undefined,
  ];
  return [side, alignment];
}

function basePosition(
  reference: FloatingRect,
  floating: FloatingSize,
  placement: HelpBubblePlacement,
  gap: number,
) {
  const [side, alignment] = splitPlacement(placement);
  if (side === "top" || side === "bottom") {
    const left =
      alignment === "start"
        ? reference.left
        : alignment === "end"
          ? reference.right - floating.width
          : reference.left + (reference.width - floating.width) / 2;
    return {
      top:
        side === "top"
          ? reference.top - gap - floating.height
          : reference.bottom + gap,
      left,
    };
  }

  const top =
    alignment === "start"
      ? reference.top
      : alignment === "end"
        ? reference.bottom - floating.height
        : reference.top + (reference.height - floating.height) / 2;
  return {
    top,
    left:
      side === "left"
        ? reference.left - gap - floating.width
        : reference.right + gap,
  };
}

function overflowScore(
  position: { top: number; left: number },
  floating: FloatingSize,
  viewport: FloatingSize,
  padding: number,
) {
  return (
    Math.max(0, padding - position.left) +
    Math.max(0, padding - position.top) +
    Math.max(0, position.left + floating.width + padding - viewport.width) +
    Math.max(0, position.top + floating.height + padding - viewport.height)
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function unique<T>(values: T[]) {
  return Array.from(new Set(values));
}
