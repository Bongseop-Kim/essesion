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

export function reformServiceLabel(data: ReformDataIn | ReformDataOut) {
  const services: string[] = [];
  if (data.tie.automatic) {
    const automatic = data.tie.automatic;
    const details = [
      automatic.mechanism === "zipper" ? "지퍼" : "끈",
      `착용자 ${automatic.wearer_height_cm}cm`,
      automatic.dimple ? "딤플" : null,
      automatic.turn_knot ? "돌려묶기" : null,
    ].filter((value): value is string => value != null);
    services.push(`자동 수선(${details.join(" · ")})`);
  }
  if (data.tie.width) {
    services.push(`폭 수선(희망 ${data.tie.width.target_width_cm}cm)`);
  }
  if (data.tie.restoration) {
    const memo = data.tie.restoration.memo?.trim();
    services.push(memo ? `복원 수선(${memo})` : "복원 수선");
  }
  return services.join(" · ");
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
