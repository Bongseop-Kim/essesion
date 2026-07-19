export type AnchoredSide = "top" | "right" | "bottom" | "left";
export type AnchoredAlignment = "start" | "end";
export type AnchoredPlacement =
  | AnchoredSide
  | `${AnchoredSide}-${AnchoredAlignment}`;

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
  side: AnchoredSide;
  top: number;
  left: number;
  arrowX?: number;
  arrowY?: number;
};

export type AnchoredArrowOptions = {
  /** 화살표의 가장자리 방향 길이 — arrowX/arrowY 클램프에 사용. */
  width: number;
  /** 화살표가 앵커 쪽으로 튀어나온 높이 — gutter에 더해진다. */
  height: number;
  /** 화살표가 플로팅 모서리에 붙지 않도록 하는 최소 여백. */
  padding: number;
};

export type AnchoredPositionOptions = {
  placement: AnchoredPlacement;
  gutter: number;
  overflowPadding: number;
  flip: boolean | AnchoredPlacement[];
  slide: boolean;
  /** 화살표 있는 오버레이(HelpBubble)만 지정 — 없으면 gap=gutter, arrowX/Y 미계산. */
  arrow?: AnchoredArrowOptions;
};

const oppositeSide: Record<AnchoredSide, AnchoredSide> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

export function positionAnchored(
  reference: FloatingRect,
  floating: FloatingSize,
  viewport: FloatingSize,
  options: AnchoredPositionOptions,
): AnchoredPosition {
  const candidates = placementCandidates(options.placement, options.flip);
  const gap = options.gutter + (options.arrow?.height ?? 0);
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
  const { arrow } = options;

  if (arrow == null) return { placement: selected.placement, side, top, left };

  if (side === "top" || side === "bottom") {
    const arrowX = clamp(
      reference.left + reference.width / 2 - left - arrow.width / 2,
      arrow.padding,
      floating.width - arrow.padding - arrow.width,
    );
    return { placement: selected.placement, side, top, left, arrowX };
  }

  const arrowY = clamp(
    reference.top + reference.height / 2 - top - arrow.width / 2,
    arrow.padding,
    floating.height - arrow.padding - arrow.width,
  );
  return { placement: selected.placement, side, top, left, arrowY };
}

function placementCandidates(
  placement: AnchoredPlacement,
  flip: boolean | AnchoredPlacement[],
) {
  if (Array.isArray(flip)) return unique([placement, ...flip]);
  if (!flip) return [placement];
  const [side, alignment] = splitPlacement(placement);
  const opposite = `${oppositeSide[side]}${alignment ? `-${alignment}` : ""}`;
  return [placement, opposite as AnchoredPlacement];
}

function splitPlacement(
  placement: AnchoredPlacement,
): [AnchoredSide, AnchoredAlignment | undefined] {
  const [side, alignment] = placement.split("-") as [
    AnchoredSide,
    AnchoredAlignment | undefined,
  ];
  return [side, alignment];
}

function basePosition(
  reference: FloatingRect,
  floating: FloatingSize,
  placement: AnchoredPlacement,
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
