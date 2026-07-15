import type {
  CustomAmountRequest,
  OrderReferenceImageIn,
} from "@essesion/api-client";

export type CustomOrderOptions = {
  fabricProvided: boolean;
  reorder: boolean;
  fabricType: "POLY" | "SILK";
  designType: "PRINTING" | "YARN_DYED";
  tieType: "MANUAL" | "AUTO";
  interlining: "POLY" | "WOOL";
  sizeType: "ADULT" | "CHILD";
  tieWidth: number | "";
  triangleStitch: boolean;
  sideStitch: boolean;
  barTack: boolean;
  fold7: boolean;
  dimple: boolean;
  turnKnot: boolean;
  spoderato: boolean;
  brandLabel: boolean;
  careLabel: boolean;
  quantity: number;
  additionalNotes: string;
};

export type QuoteContact = {
  contactName: string;
  businessName: string;
  contactMethod: "phone" | "email";
  contactValue: string;
};

export type CustomOrderDraft = {
  options: CustomOrderOptions;
  contact: QuoteContact;
  imageRefs: OrderReferenceImageIn[];
  totalCost: number;
};

export const DEFAULT_CUSTOM_ORDER_OPTIONS: CustomOrderOptions = {
  fabricProvided: false,
  reorder: false,
  fabricType: "POLY",
  designType: "PRINTING",
  tieType: "MANUAL",
  interlining: "WOOL",
  sizeType: "ADULT",
  tieWidth: "",
  triangleStitch: true,
  sideStitch: true,
  barTack: false,
  fold7: false,
  dimple: false,
  turnKnot: false,
  spoderato: false,
  brandLabel: false,
  careLabel: false,
  quantity: 4,
  additionalNotes: "",
};

export const DEFAULT_QUOTE_CONTACT: QuoteContact = {
  contactName: "",
  businessName: "",
  contactMethod: "phone",
  contactValue: "",
};

export function customOrderApiOptions(options: CustomOrderOptions) {
  const noFabricCharge = options.fabricProvided;
  return {
    fabric_provided: noFabricCharge,
    reorder: options.reorder,
    fabric_type: noFabricCharge ? null : options.fabricType,
    design_type: noFabricCharge ? null : options.designType,
    tie_type: options.tieType === "AUTO" ? "AUTO" : "",
    interlining: options.interlining === "WOOL" ? "WOOL" : "",
    size_type: options.sizeType,
    tie_width: options.tieWidth === "" ? null : options.tieWidth,
    triangle_stitch: options.triangleStitch,
    side_stitch: options.sideStitch,
    bar_tack: options.barTack,
    fold7: options.fold7,
    dimple: options.dimple,
    turn_knot: options.turnKnot,
    spoderato: options.spoderato,
    brand_label: options.brandLabel,
    care_label: options.careLabel,
  } satisfies CustomAmountRequest["options"];
}

export type CustomOrderSectionId =
  | "quantity"
  | "fabric"
  | "sewing"
  | "spec"
  | "finishing"
  | "attachment";

export type CustomOrderFieldId =
  | "quantity"
  | "tieWidth"
  | "dimple"
  | "turnKnot"
  | "contactName"
  | "contactValue";

export type CustomOrderValidationError = {
  section: CustomOrderSectionId;
  field: CustomOrderFieldId;
  message: string;
};

export const MAX_CUSTOM_ORDER_QUANTITY = 10_000;

export function invalidCustomOrderSection(
  options: CustomOrderOptions,
  contact?: QuoteContact,
  isQuoteMode = false,
): CustomOrderValidationError | null {
  if (
    !Number.isInteger(options.quantity) ||
    options.quantity < 4 ||
    options.quantity > MAX_CUSTOM_ORDER_QUANTITY
  ) {
    return {
      section: "quantity",
      field: "quantity",
      message: `수량은 4~${MAX_CUSTOM_ORDER_QUANTITY.toLocaleString("ko-KR")}개로 입력해 주세요.`,
    };
  }
  if (options.tieType !== "AUTO" && options.dimple) {
    return {
      section: "sewing",
      field: "dimple",
      message: "딤플은 자동 타이에서만 선택할 수 있습니다.",
    };
  }
  if (options.tieType !== "AUTO" && options.turnKnot) {
    return {
      section: "sewing",
      field: "turnKnot",
      message: "돌려묶기는 자동 타이에서만 선택할 수 있습니다.",
    };
  }
  if (
    options.tieWidth === "" ||
    options.tieWidth < 6 ||
    options.tieWidth > 12 ||
    !Number.isInteger(options.tieWidth * 2)
  ) {
    return {
      section: "spec",
      field: "tieWidth",
      message: "넥타이 폭은 6~12cm 사이에서 0.5cm 단위로 입력해 주세요.",
    };
  }
  if (isQuoteMode && !contact?.contactName.trim()) {
    return {
      section: "quantity",
      field: "contactName",
      message: "담당자 성함을 입력해 주세요.",
    };
  }
  if (isQuoteMode && !validContact(contact)) {
    return {
      section: "quantity",
      field: "contactValue",
      message:
        contact?.contactMethod === "email"
          ? "올바른 이메일 주소를 입력해 주세요."
          : "올바른 연락처를 입력해 주세요.",
    };
  }
  return null;
}

function validContact(contact: QuoteContact | undefined) {
  const value = contact?.contactValue.trim() ?? "";
  if (contact?.contactMethod === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  return /^[0-9+()\-\s]{8,20}$/.test(value);
}

export function customOrderSummary(options: CustomOrderOptions) {
  const fabric = options.fabricProvided
    ? "원단 직접 제공"
    : options.reorder
      ? `재주문 · ${options.fabricType === "SILK" ? "실크" : "폴리"} · ${
          options.designType === "YARN_DYED" ? "선염" : "날염"
        }`
      : `${options.fabricType === "SILK" ? "실크" : "폴리"} · ${
          options.designType === "YARN_DYED" ? "선염" : "날염"
        }`;
  return [
    { label: "수량", value: `${options.quantity}개` },
    { label: "원단", value: fabric },
    {
      label: "타이",
      value: `${options.tieType === "AUTO" ? "자동 타이" : "수동 타이"}${
        options.turnKnot ? " · 돌려묶기" : ""
      }`,
    },
    {
      label: "규격",
      value: `${options.sizeType === "ADULT" ? "성인용" : "아동용"} · ${
        options.tieWidth === "" ? "폭 미입력" : `${options.tieWidth}cm`
      }`,
    },
  ];
}
