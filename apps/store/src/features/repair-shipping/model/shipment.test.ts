import type { ConfirmedOrder } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import { planRepairOutcome } from "./post-confirm";
import {
  emptyShipmentForm,
  isRepairShipmentDraft,
  type RepairShipmentDraft,
  type RepairShipmentFormState,
  shipmentDraftFromForm,
  shipmentFormFromDraft,
  shipmentInvalidReason,
  shipmentRequestBody,
} from "./shipment";

function form(
  overrides: Partial<RepairShipmentFormState> = {},
): RepairShipmentFormState {
  return { ...emptyShipmentForm(), ...overrides };
}

describe("shipmentDraftFromForm", () => {
  it("빈 폼(순수 발송 확인)도 유효한 draft", () => {
    expect(shipmentDraftFromForm(form())).toEqual({
      courierCompany: "",
      trackingNumber: "",
      memo: "",
      photoObjectKeys: [],
    });
  });

  it("택배사/송장번호 중 하나만 입력하면 null", () => {
    expect(shipmentDraftFromForm(form({ courierCompany: "cj" }))).toBeNull();
    expect(shipmentDraftFromForm(form({ trackingNumber: "123" }))).toBeNull();
  });

  it("송장 입력 시 trim·lowercase 적용", () => {
    expect(
      shipmentDraftFromForm(
        form({ courierCompany: " CJ ", trackingNumber: " 12345 " }),
      ),
    ).toEqual({
      courierCompany: "cj",
      trackingNumber: "12345",
      memo: "",
      photoObjectKeys: [],
    });
  });

  it("memo 500자 초과면 null, 그 외 trim", () => {
    expect(shipmentDraftFromForm(form({ memo: "가".repeat(501) }))).toBeNull();
    expect(shipmentDraftFromForm(form({ memo: " 특이사항 " }))?.memo).toBe(
      "특이사항",
    );
  });

  it("사진은 최대 3장으로 잘림", () => {
    const photos = ["a", "b", "c", "d"].map((objectKey) => ({
      objectKey,
      previewUrl: null,
    }));
    expect(shipmentDraftFromForm(form({ photos }))?.photoObjectKeys).toEqual([
      "a",
      "b",
      "c",
    ]);
  });
});

describe("shipmentFormFromDraft ↔ shipmentDraftFromForm 라운드트립", () => {
  it("송장 포함", () => {
    const draft: RepairShipmentDraft = {
      courierCompany: "hanjin",
      trackingNumber: "98765",
      memo: "문 앞 수령",
      photoObjectKeys: ["uploads/repair_shipping_upload/a.png"],
    };
    expect(shipmentDraftFromForm(shipmentFormFromDraft(draft))).toEqual(draft);
  });

  it("순수 발송 확인", () => {
    const draft: RepairShipmentDraft = {
      courierCompany: "",
      trackingNumber: "",
      memo: "",
      photoObjectKeys: [],
    };
    expect(shipmentDraftFromForm(shipmentFormFromDraft(draft))).toEqual(draft);
  });
});

describe("shipmentRequestBody", () => {
  it("송장 있으면 tracking — memo·photos 매핑", () => {
    expect(
      shipmentRequestBody({
        courierCompany: "cj",
        trackingNumber: "123",
        memo: "문 앞",
        photoObjectKeys: ["k1", "k2"],
      }),
    ).toEqual({
      type: "tracking",
      body: {
        courier_company: "cj",
        tracking_number: "123",
        memo: "문 앞",
        photos: [{ object_key: "k1" }, { object_key: "k2" }],
      },
    });
  });

  it("송장 없으면 no-tracking — 사유 없이, 빈 memo는 null", () => {
    expect(
      shipmentRequestBody({
        courierCompany: "",
        trackingNumber: "",
        memo: "",
        photoObjectKeys: [],
      }),
    ).toEqual({
      type: "no-tracking",
      body: { memo: null, photos: [] },
    });
  });
});

describe("isRepairShipmentDraft", () => {
  it("정상 draft 통과 (송장 유무 모두)", () => {
    expect(
      isRepairShipmentDraft({
        courierCompany: "cj",
        trackingNumber: "1",
        memo: "",
        photoObjectKeys: [],
      }),
    ).toBe(true);
    expect(
      isRepairShipmentDraft({
        courierCompany: "",
        trackingNumber: "",
        memo: "메모",
        photoObjectKeys: ["k"],
      }),
    ).toBe(true);
  });

  it("오염·구버전 값 거부", () => {
    expect(isRepairShipmentDraft(null)).toBe(false);
    expect(isRepairShipmentDraft("draft")).toBe(false);
    // 구버전(kind 분기) draft — memo 없음
    expect(
      isRepairShipmentDraft({
        kind: "has-tracking",
        courierCompany: "cj",
        trackingNumber: "1",
        photoObjectKeys: [],
      }),
    ).toBe(false);
    // 반쪽짜리 송장 쌍
    expect(
      isRepairShipmentDraft({
        courierCompany: "cj",
        trackingNumber: "",
        memo: "",
        photoObjectKeys: [],
      }),
    ).toBe(false);
    expect(
      isRepairShipmentDraft({
        courierCompany: "",
        trackingNumber: "",
        memo: "",
        photoObjectKeys: [1],
      }),
    ).toBe(false);
  });
});

describe("shipmentInvalidReason", () => {
  it("송장 쌍 불일치 문구 분기", () => {
    expect(shipmentInvalidReason(form({ courierCompany: "cj" }))).toBe(
      "송장번호를 입력해 주세요.",
    );
    expect(shipmentInvalidReason(form({ trackingNumber: "1" }))).toBe(
      "택배사를 선택해 주세요.",
    );
  });

  it("빈 폼·완성 쌍은 통과, memo 초과만 차단", () => {
    expect(shipmentInvalidReason(form())).toBeNull();
    expect(
      shipmentInvalidReason(
        form({ courierCompany: "cj", trackingNumber: "1" }),
      ),
    ).toBeNull();
    expect(shipmentInvalidReason(form({ memo: "가".repeat(501) }))).toBe(
      "메모는 500자 이내로 입력해 주세요.",
    );
  });
});

describe("planRepairOutcome", () => {
  const order = (overrides: Partial<ConfirmedOrder>): ConfirmedOrder => ({
    order_id: "order-1",
    order_number: "R20260710-0001",
    order_type: "repair",
    status: "발송대기",
    ...overrides,
  });
  const draft: RepairShipmentDraft = {
    courierCompany: "cj",
    trackingNumber: "1",
    memo: "",
    photoObjectKeys: [],
  };

  it("repair 주문 없음 → none", () => {
    expect(
      planRepairOutcome(
        [order({ order_type: "sale", status: "진행중" })],
        draft,
      ),
    ).toEqual({ kind: "none" });
  });

  it("수거예정 → pickup", () => {
    expect(planRepairOutcome([order({ status: "수거예정" })], draft)).toEqual({
      kind: "pickup",
    });
  });

  it("발송대기 + draft → auto-submit", () => {
    expect(planRepairOutcome([order({})], draft)).toEqual({
      kind: "auto-submit",
      orderId: "order-1",
      draft,
    });
  });

  it("발송대기 + draft 없음 → register-cta", () => {
    expect(planRepairOutcome([order({})], null)).toEqual({
      kind: "register-cta",
      orderId: "order-1",
    });
  });

  it("발송중·발송확인중(멱등 재confirm) → submitted, 재제출 없음", () => {
    expect(planRepairOutcome([order({ status: "발송중" })], draft)).toEqual({
      kind: "submitted",
    });
    expect(planRepairOutcome([order({ status: "발송확인중" })], null)).toEqual({
      kind: "submitted",
    });
  });

  it("sale+repair 혼합에서 repair를 찾는다", () => {
    expect(
      planRepairOutcome(
        [order({ order_type: "sale", status: "진행중" }), order({})],
        null,
      ),
    ).toEqual({ kind: "register-cta", orderId: "order-1" });
  });
});
