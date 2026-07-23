import type {
  ReformDataIn,
  ReformDataOut,
  ReformImageIn,
  ReformPricingOut,
} from "@essesion/api-client";

export type ReformTieForm = {
  itemId: string;
  file: File | null;
  previewUrl: string | null;
  uploadedImage: ReformImageIn | null;
  automaticEnabled: boolean;
  mechanism: "" | "zipper" | "string";
  wearerHeightCm: number | null;
  dimple: boolean;
  turnKnot: boolean;
  widthEnabled: boolean;
  targetWidthCm: number | null;
  restorationEnabled: boolean;
  restorationMemo: string;
};

export type ReformFormValues = { ties: ReformTieForm[] };

export function createReformTie(): ReformTieForm {
  return {
    itemId: `reform:${crypto.randomUUID()}`,
    file: null,
    previewUrl: null,
    uploadedImage: null,
    automaticEnabled: true,
    mechanism: "zipper",
    wearerHeightCm: null,
    dimple: false,
    turnKnot: false,
    widthEnabled: false,
    targetWidthCm: null,
    restorationEnabled: false,
    restorationMemo: "",
  };
}

export function reformDataFromForm(tie: ReformTieForm): ReformDataIn {
  if (!tie.uploadedImage) throw new Error("수선 사진이 필요합니다.");
  return {
    tie: {
      image: tie.uploadedImage,
      automatic: tie.automaticEnabled
        ? {
            mechanism: requireMechanism(tie.mechanism),
            wearer_height_cm: requirePositive(tie.wearerHeightCm),
            dimple: tie.dimple,
            turn_knot: tie.mechanism === "zipper" && tie.turnKnot,
          }
        : null,
      width: tie.widthEnabled
        ? { target_width_cm: requirePositive(tie.targetWidthCm) }
        : null,
      restoration: tie.restorationEnabled
        ? { memo: tie.restorationMemo.trim() }
        : null,
    },
  };
}

export function reformFormFromData(
  itemId: string,
  data: ReformDataIn | ReformDataOut,
): ReformTieForm {
  const tie = data.tie;
  const image = tie.image as ReformImageIn;
  return {
    ...createReformTie(),
    itemId,
    uploadedImage: {
      object_key: image.object_key,
      claim_token: image.claim_token ?? null,
    },
    automaticEnabled: !!tie.automatic,
    mechanism: tie.automatic?.mechanism ?? "",
    wearerHeightCm: tie.automatic?.wearer_height_cm ?? null,
    dimple: tie.automatic?.dimple ?? false,
    turnKnot: tie.automatic?.turn_knot ?? false,
    widthEnabled: !!tie.width,
    targetWidthCm: tie.width?.target_width_cm ?? null,
    restorationEnabled: !!tie.restoration,
    restorationMemo: tie.restoration?.memo ?? "",
  };
}

export function calculateReformCost(
  tie: Pick<
    ReformTieForm,
    "automaticEnabled" | "widthEnabled" | "restorationEnabled"
  >,
  pricing: ReformPricingOut,
) {
  if (tie.automaticEnabled && (tie.widthEnabled || tie.restorationEnabled)) {
    return pricing.automatic_combined_cost;
  }
  if (tie.automaticEnabled) return pricing.automatic_cost;
  if (tie.widthEnabled && tie.restorationEnabled) {
    return pricing.width_restoration_cost;
  }
  if (tie.widthEnabled) return pricing.width_cost;
  if (tie.restorationEnabled) return pricing.restoration_cost;
  return 0;
}

export function calculateReformDataCost(
  data: ReformDataIn | ReformDataOut,
  pricing: ReformPricingOut,
) {
  return calculateReformCost(
    {
      automaticEnabled: !!data.tie.automatic,
      widthEnabled: !!data.tie.width,
      restorationEnabled: !!data.tie.restoration,
    },
    pricing,
  );
}

type ReformServicePartsInput = {
  automatic?: {
    mechanism: string | null;
    wearerHeightCm: number | null;
    dimple?: boolean;
    turnKnot?: boolean;
  } | null;
  width?: { targetWidthCm: number | null } | null;
  restoration?: { memo: string | null } | null;
};

/** 수선 옵션을 사람이 읽는 요약 조각으로. API 데이터(reformServiceLabel)와 폼 값이 공유. */
export function reformServiceParts(tie: ReformServicePartsInput): string[] {
  const parts: string[] = [];
  if (tie.automatic) {
    const details = [
      tie.automatic.mechanism === "zipper"
        ? "지퍼"
        : tie.automatic.mechanism === "string"
          ? "끈"
          : null,
      tie.automatic.wearerHeightCm != null
        ? `착용자 ${tie.automatic.wearerHeightCm}cm`
        : null,
      tie.automatic.dimple ? "딤플" : null,
      tie.automatic.turnKnot ? "돌려묶기" : null,
    ].filter((value): value is string => value != null);
    parts.push(
      details.length ? `자동 수선(${details.join(" · ")})` : "자동 수선",
    );
  }
  if (tie.width) {
    parts.push(
      tie.width.targetWidthCm != null
        ? `폭 수선(희망 ${tie.width.targetWidthCm}cm)`
        : "폭 수선",
    );
  }
  if (tie.restoration) {
    const memo = tie.restoration.memo?.trim();
    parts.push(memo ? `복원 수선(${memo})` : "복원 수선");
  }
  return parts;
}

export function reformServiceLabel(data: ReformDataIn | ReformDataOut) {
  return reformServiceParts({
    automatic: data.tie.automatic
      ? {
          mechanism: data.tie.automatic.mechanism,
          wearerHeightCm: data.tie.automatic.wearer_height_cm,
          dimple: data.tie.automatic.dimple,
          turnKnot: data.tie.automatic.turn_knot,
        }
      : null,
    width: data.tie.width
      ? { targetWidthCm: data.tie.width.target_width_cm }
      : null,
    restoration: data.tie.restoration
      ? { memo: data.tie.restoration.memo ?? null }
      : null,
  }).join(" · ");
}

function requirePositive(value: number | null) {
  if (value == null || !Number.isFinite(value) || value <= 0) {
    throw new Error("필수 숫자 입력을 확인해 주세요.");
  }
  return value;
}

function requireMechanism(value: ReformTieForm["mechanism"]) {
  if (value !== "zipper" && value !== "string") {
    throw new Error("자동 수선 방식을 선택해 주세요.");
  }
  return value;
}
