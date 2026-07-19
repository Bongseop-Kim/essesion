import { describe, expect, it } from "vitest";

import {
  type AnchoredPlacement,
  type FloatingRect,
  positionAnchored,
} from "./anchored-position";

const reference: FloatingRect = {
  top: 200,
  right: 340,
  bottom: 240,
  left: 300,
  width: 40,
  height: 40,
};
const floating = { width: 160, height: 80 };
const viewport = { width: 800, height: 600 };
const defaults = {
  gutter: 4,
  overflowPadding: 16,
  flip: false as const,
  slide: false,
  arrow: { width: 12, height: 8, padding: 14 },
};

describe("positionAnchored", () => {
  it.each<[AnchoredPlacement, number, number]>([
    ["top", 108, 240],
    ["top-start", 108, 300],
    ["top-end", 108, 180],
    ["bottom", 252, 240],
    ["bottom-start", 252, 300],
    ["bottom-end", 252, 180],
    ["left", 180, 128],
    ["left-start", 200, 128],
    ["left-end", 160, 128],
    ["right", 180, 352],
    ["right-start", 200, 352],
    ["right-end", 160, 352],
  ])("places %s at the expected coordinates", (placement, top, left) => {
    expect(
      positionAnchored(reference, floating, viewport, {
        ...defaults,
        placement,
      }),
    ).toMatchObject({ placement, top, left });
  });

  it("flips when the preferred side overflows", () => {
    const result = positionAnchored(
      { ...reference, top: 8, bottom: 48 },
      floating,
      viewport,
      { ...defaults, placement: "top", flip: true },
    );
    expect(result).toMatchObject({ placement: "bottom", top: 60 });
  });

  it("slides inside the viewport and keeps the arrow near its reference", () => {
    const result = positionAnchored(
      { ...reference, left: 0, right: 40 },
      floating,
      viewport,
      { ...defaults, placement: "bottom-start", slide: true },
    );
    expect(result.left).toBe(16);
    expect(result.arrowX).toBe(14);
  });

  it("uses explicit fallback placements in order", () => {
    const result = positionAnchored(
      { ...reference, top: 20, bottom: 60 },
      floating,
      viewport,
      {
        ...defaults,
        placement: "top",
        flip: ["right-start", "bottom-end"],
      },
    );
    expect(result.placement).toBe("right-start");
  });

  it("uses the bare gutter and skips arrow coordinates without an arrow", () => {
    const { arrow: _arrow, ...noArrow } = defaults;
    const result = positionAnchored(reference, floating, viewport, {
      ...noArrow,
      placement: "bottom",
    });
    expect(result).toMatchObject({ placement: "bottom", top: 244, left: 240 });
    expect(result.arrowX).toBeUndefined();
    expect(result.arrowY).toBeUndefined();
  });

  it("skips arrowY on side placements without an arrow", () => {
    const { arrow: _arrow, ...noArrow } = defaults;
    const result = positionAnchored(reference, floating, viewport, {
      ...noArrow,
      placement: "right",
    });
    expect(result).toMatchObject({ placement: "right", top: 180, left: 344 });
    expect(result.arrowY).toBeUndefined();
  });
});
