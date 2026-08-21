export type OrderContentRow = { label: string; value: string };
export type OrderItemContent = {
  typeLabel: string;
  rows: OrderContentRow[];
  tags: string[];
  memo?: string;
};

const OPTION_LABELS: Record<string, string> = {
  fabric_provided: "원단 제공",
  reorder: "재주문",
  fabric_type: "원단",
  design_type: "디자인",
  tie_type: "타이 방식",
  interlining: "심지",
  size_type: "사이즈",
  tie_width: "타이 폭",
  triangle_stitch: "삼각 봉제",
  side_stitch: "옆선 봉제",
  bar_tack: "바텍",
  fold7: "7폴드",
  dimple: "딤플",
  turn_knot: "돌려묶기",
  spoderato: "스포데라토",
  brand_label: "브랜드 라벨",
  care_label: "케어 라벨",
};

const OPTION_VALUES: Record<string, string> = {
  POLY: "폴리",
  SILK: "실크",
  PRINTING: "날염",
  YARN_DYED: "선염",
  AUTO: "자동 타이",
  MANUAL: "수동 타이",
  WOOL: "울",
  ADULT: "성인용",
  CHILD: "아동용",
};

const FINISHING_OPTIONS = new Set([
  "triangle_stitch",
  "side_stitch",
  "bar_tack",
  "fold7",
  "dimple",
  "turn_knot",
  "spoderato",
  "brand_label",
  "care_label",
]);

const TECHNICAL_OPTION_KEYS = new Set(["object_key", "image_id", "upload_id"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function visibleValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (typeof value === "string") return OPTION_VALUES[value] ?? value;
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : null;
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return String(value);
  }
}

function optionContent(
  options: unknown,
): Pick<OrderItemContent, "rows" | "tags"> {
  const rows: OrderContentRow[] = [];
  const tags: string[] = [];
  for (const [key, value] of Object.entries(record(options) ?? {})) {
    if (TECHNICAL_OPTION_KEYS.has(key)) continue;
    const label = OPTION_LABELS[key] ?? key.replaceAll("_", " ");
    if (FINISHING_OPTIONS.has(key) && typeof value === "boolean") {
      if (value) tags.push(label);
      continue;
    }
    const formatted = visibleValue(value);
    if (formatted !== null) rows.push({ label, value: formatted });
  }
  return { rows, tags };
}

const MECHANISM_LABELS: Record<string, string> = {
  zipper: "지퍼",
  string: "끈",
};

/**
 * 수선 품목의 `item_data.tie`를 읽는 **유일한** 지점 — store·admin은 표기만 달리 한다.
 * `restoration.memo`는 trim 결과이며 비어 있을 수 있다(복원 선택 여부는 null로 구분).
 */
export function decodeTieSpec(itemData: unknown) {
  const tie = record(record(itemData)?.tie);
  if (tie === null) return null;
  const automatic = record(tie.automatic);
  const width = record(tie.width);
  const restoration = record(tie.restoration);
  const cm = (value: unknown) => (typeof value === "number" ? value : null);
  return {
    automatic: automatic && {
      mechanismLabel: MECHANISM_LABELS[String(automatic.mechanism)] ?? "미지정",
      wearerHeightCm: cm(automatic.wearer_height_cm),
      turnKnot: automatic.turn_knot === true,
      dimple: automatic.dimple === true,
    },
    width: width && { targetWidthCm: cm(width.target_width_cm) },
    restoration: restoration && {
      memo: typeof restoration.memo === "string" ? restoration.memo.trim() : "",
    },
  };
}

export function decodeOrderItemContent(
  orderType: string,
  itemData: unknown,
  quantity: number,
): OrderItemContent | null {
  const data = record(itemData);
  if (data === null) return null;

  if (orderType === "custom" || orderType === "sample") {
    const content = optionContent(data.options);
    const sampleType = visibleValue(data.sample_type);
    const typeLabel =
      orderType === "custom"
        ? "맞춤 제작"
        : data.sample_type === "fabric"
          ? "원단 샘플"
          : data.sample_type === "sewing"
            ? "봉제 샘플"
            : data.sample_type === "fabric_and_sewing"
              ? "원단 + 봉제 샘플"
              : "샘플 제작";
    return {
      typeLabel,
      rows: [
        { label: "제작 수량", value: `${quantity}개` },
        ...(sampleType ? [{ label: "샘플 유형", value: typeLabel }] : []),
        ...content.rows,
      ],
      tags: content.tags,
      memo:
        typeof data.additional_notes === "string" &&
        data.additional_notes.trim()
          ? data.additional_notes.trim()
          : undefined,
    };
  }

  if (orderType !== "repair") return null;
  const tie = decodeTieSpec(data);
  if (tie === null) return null;
  const rows: OrderContentRow[] = [];
  const tags: string[] = [];
  if (tie.automatic) {
    rows.push({ label: "자동 타이 방식", value: tie.automatic.mechanismLabel });
    if (tie.automatic.wearerHeightCm !== null) {
      rows.push({
        label: "착용자 키",
        value: `${tie.automatic.wearerHeightCm}cm`,
      });
    }
    if (tie.automatic.dimple) tags.push("딤플");
    if (tie.automatic.turnKnot) tags.push("돌려묶기");
  }
  if (tie.width?.targetWidthCm != null) {
    rows.push({ label: "희망 타이 폭", value: `${tie.width.targetWidthCm}cm` });
  }
  const memo = tie.restoration?.memo || undefined;
  return rows.length > 0 || tags.length > 0 || memo
    ? { typeLabel: "수선", rows, tags, memo }
    : null;
}
