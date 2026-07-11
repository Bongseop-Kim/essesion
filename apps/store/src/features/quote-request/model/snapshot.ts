/** 견적에 저장된 snake_case 옵션 스냅샷을 현재 주문 제작 요약 입력으로 정규화한다. */
export function quoteCustomOrderOptions(
  options: Record<string, unknown>,
  quantity: number,
  additionalNotes: string,
) {
  return {
    fabricProvided: readBoolean(options.fabric_provided, false),
    reorder: readBoolean(options.reorder, false),
    fabricType: options.fabric_type === "SILK" ? "SILK" : "POLY",
    designType: options.design_type === "YARN_DYED" ? "YARN_DYED" : "PRINTING",
    tieType: options.tie_type === "AUTO" ? "AUTO" : "MANUAL",
    interlining: options.interlining === "WOOL" ? "WOOL" : "POLY",
    sizeType: options.size_type === "CHILD" ? "CHILD" : "ADULT",
    tieWidth: readTieWidth(options.tie_width),
    triangleStitch: readBoolean(options.triangle_stitch, true),
    sideStitch: readBoolean(options.side_stitch, true),
    barTack: readBoolean(options.bar_tack, false),
    fold7: readBoolean(options.fold7, false),
    dimple: readBoolean(options.dimple, false),
    turnKnot: readBoolean(options.turn_knot, false),
    spoderato: readBoolean(options.spoderato, false),
    brandLabel: readBoolean(options.brand_label, false),
    careLabel: readBoolean(options.care_label, false),
    quantity,
    additionalNotes,
  } as const;
}

export function quoteReferenceImageKeys(images: readonly unknown[]): string[] {
  const keys = new Set<string>();
  for (const image of images) {
    if (!image || typeof image !== "object" || !("object_key" in image)) {
      continue;
    }
    const key = image.object_key;
    if (typeof key === "string" && key.trim()) keys.add(key.trim());
  }
  return [...keys];
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function readTieWidth(value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}
