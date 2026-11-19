import type {
  CustomAmountRequest,
  OrderReferenceImageIn,
  ReferenceImageIn,
} from "@essesion/api-client";

export type CustomOrderOptions = {
  fabricProvided: boolean;
  reorder: boolean;
  fabricType: "POLY" | "SILK";
  /** 날염은 더 받지 않는다 — 새 주문은 항상 선염. 지난 견적 표기용으로만 PRINTING을 읽는다. */
  designType: "PRINTING" | "YARN_DYED";
  /** 포인트(자수·열전사 필름) — 고르면 정해진 원단으로 만들어 원단 선택·원단비가 없다 */
  pointEnabled: boolean;
  pointType: "EMBROIDERY" | "HEAT_TRANSFER";
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

/** 주문서 → 결제 페이지로 넘기는 초안. 참고 이미지는 완료된 업로드(upload_id)다. */
export type CustomOrderDraft = {
  options: CustomOrderOptions;
  imageRefs: OrderReferenceImageIn[];
  totalCost: number;
};

/** 주문서 → 견적 요청 페이지로 넘기는 초안. 견적의 참고 이미지는 스테이징 키(object_key)다. */
export type CustomQuoteDraft = {
  /** 초안을 만든 계정 — 로그인이 끊겨 다른 계정으로 돌아오면 견적 요청 페이지가 버린다. */
  ownerUserId: string;
  options: CustomOrderOptions;
  imageRefs: ReferenceImageIn[];
  totalCost: number;
};

export const DEFAULT_CUSTOM_ORDER_OPTIONS: CustomOrderOptions = {
  fabricProvided: false,
  reorder: false,
  fabricType: "POLY",
  designType: "YARN_DYED",
  pointEnabled: false,
  pointType: "EMBROIDERY",
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

// 딤플은 자동 타이에서만·돌려묶기와 함께만 — 예전 임시 저장(draft) 조합도 맞춰 정규화.
// 포인트 주문은 둘 다 고를 수 없다. 과금 요청(customOrderApiOptions)과 요약(customOrderSummary)이 공유한다.
function normalizedTieOptions(options: CustomOrderOptions) {
  if (options.pointEnabled) return { dimple: false, turnKnot: false };
  const dimple = options.tieType === "AUTO" && options.dimple;
  return { dimple, turnKnot: options.turnKnot || dimple };
}

/**
 * 서버로 보내는 사양. 포인트 주문은 정해진 넥타이 위에 자수·필름만 올리므로 타이 방식·라벨·재주문만
 * 고른 값 그대로 보내고 나머지(심지·규격·봉제 옵션·원단 제공)는 "선택 안 함"으로 고정한다 — 서버도
 * 포인트 주문의 이 옵션을 거절한다(docs/api-spec/money.md §3). 화면 state는 건드리지 않아 포인트를
 * 끄면 골라 둔 값이 돌아온다.
 */
export function customOrderApiOptions(options: CustomOrderOptions) {
  const point = options.pointEnabled;
  const noFabricCharge = options.fabricProvided || point;
  const tie = normalizedTieOptions(options);
  return {
    fabric_provided: !point && options.fabricProvided,
    reorder: options.reorder,
    point: point ? options.pointType : null,
    fabric_type: noFabricCharge ? null : options.fabricType,
    design_type: noFabricCharge ? null : options.designType,
    tie_type: options.tieType === "AUTO" ? "AUTO" : "",
    interlining: !point && options.interlining === "WOOL" ? "WOOL" : "",
    size_type: point ? null : options.sizeType,
    tie_width: point || options.tieWidth === "" ? null : options.tieWidth,
    triangle_stitch: !point && options.triangleStitch,
    side_stitch: !point && options.sideStitch,
    bar_tack: !point && options.barTack,
    fold7: !point && options.fold7,
    dimple: tie.dimple,
    turn_knot: tie.turnKnot,
    spoderato: !point && options.spoderato,
    brand_label: options.brandLabel,
    care_label: options.careLabel,
  } satisfies CustomAmountRequest["options"];
}

export type CustomOrderSectionId =
  | "quantity"
  | "fabric"
  | "point"
  | "sewing"
  | "spec"
  | "finishing"
  | "attachment";

export type CustomOrderFieldId =
  | "quantity"
  | "tieWidth"
  | "dimple"
  | "turnKnot";

export type CustomOrderValidationError = {
  section: CustomOrderSectionId;
  field: CustomOrderFieldId;
  message: string;
};

export const MAX_CUSTOM_ORDER_QUANTITY = 10_000;

export function invalidCustomOrderSection(
  options: CustomOrderOptions,
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
  // 포인트 주문은 딤플·돌려묶기·넥타이 폭 칸이 숨는다 — 숨은 칸으로 제출을 막지 않는다.
  if (!options.pointEnabled) {
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
      return TIE_WIDTH_ERROR;
    }
  }
  return null;
}

export type QuoteContactError = {
  field: "contactName" | "contactValue";
  message: string;
};

/** 견적 요청 페이지의 연락처 검증 — 주문서는 연락처를 다루지 않는다. */
export function invalidQuoteContact(
  contact: QuoteContact,
): QuoteContactError | null {
  if (!contact.contactName.trim()) {
    return { field: "contactName", message: "담당자 성함을 입력해 주세요." };
  }
  if (!validContact(contact)) {
    return {
      field: "contactValue",
      message:
        contact.contactMethod === "email"
          ? "올바른 이메일 주소를 입력해 주세요."
          : "올바른 연락처를 입력해 주세요.",
    };
  }
  return null;
}

/** 넥타이 폭 필수 검증 — 제출 시(invalidCustomOrderSection)와 blur 인라인 검증이 공유 */
export const TIE_WIDTH_ERROR: CustomOrderValidationError = {
  section: "spec",
  field: "tieWidth",
  message: "넥타이 폭은 6~12cm 사이에서 0.5cm 단위로 입력해 주세요.",
};

function validContact(contact: QuoteContact) {
  const value = contact.contactValue.trim();
  if (contact.contactMethod === "email") {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
  return /^[0-9+()\-\s]{8,20}$/.test(value);
}

export const POINT_TYPE_LABELS = {
  EMBROIDERY: "자수",
  HEAT_TRANSFER: "열전사 필름",
} as const;

export function customOrderSummary(options: CustomOrderOptions) {
  const ownFabric = `${options.fabricType === "SILK" ? "실크" : "폴리"} · ${
    options.designType === "YARN_DYED" ? "선염" : "날염"
  }`;
  // 포인트가 먼저다 — 포인트 주문은 원단 직접 제공과 함께 고를 수 없다.
  const fabric = options.pointEnabled
    ? options.reorder
      ? "재주문 · 정해진 원단"
      : "정해진 원단"
    : options.fabricProvided
      ? "원단 직접 제공"
      : options.reorder
        ? `재주문 · ${ownFabric}`
        : ownFabric;
  return [
    { label: "수량", value: `${options.quantity}개` },
    { label: "원단", value: fabric },
    ...(options.pointEnabled
      ? [{ label: "포인트", value: POINT_TYPE_LABELS[options.pointType] }]
      : []),
    {
      label: "타이",
      value: `${options.tieType === "AUTO" ? "자동 타이" : "수동 타이"}${
        normalizedTieOptions(options).turnKnot ? " · 돌려묶기" : ""
      }`,
    },
    // 포인트 주문은 규격을 고르지 않는다.
    ...(options.pointEnabled
      ? []
      : [
          {
            label: "규격",
            value: `${options.sizeType === "ADULT" ? "성인용" : "아동용"} · ${
              options.tieWidth === "" ? "폭 미입력" : `${options.tieWidth}cm`
            }`,
          },
        ]),
  ];
}
