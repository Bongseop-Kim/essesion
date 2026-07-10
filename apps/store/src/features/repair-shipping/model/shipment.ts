import type {
  RepairNoTrackingRequest,
  RepairTrackingRequest,
} from "@essesion/api-client";

export const MAX_REPAIR_PHOTOS = 3;
const MAX_MEMO_LENGTH = 500;

/** 발송 확인 초안 — 필수는 "발송했다"는 선언뿐, 송장·사진·메모는 선택 증빙.
 *  sessionStorage snapshot·location.state에 들어가는 직렬화 가능 값 (File 없음, object_key만).
 *  courierCompany/trackingNumber는 둘 다 채우거나 둘 다 비운다. */
export type RepairShipmentDraft = {
  courierCompany: string;
  trackingNumber: string;
  memo: string;
  photoObjectKeys: string[];
};

function hasTracking(draft: RepairShipmentDraft): boolean {
  return draft.courierCompany.length > 0 && draft.trackingNumber.length > 0;
}

/** sessionStorage/location.state에서 읽은 unknown 값 방어 (다른 세션·구버전 스키마) */
export function isRepairShipmentDraft(
  value: unknown,
): value is RepairShipmentDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Record<string, unknown>;
  if (
    typeof draft.courierCompany !== "string" ||
    typeof draft.trackingNumber !== "string" ||
    typeof draft.memo !== "string" ||
    !Array.isArray(draft.photoObjectKeys) ||
    !draft.photoObjectKeys.every((key) => typeof key === "string")
  ) {
    return false;
  }
  // 송장 정보는 쌍으로만 유효 — 반쪽짜리 draft는 거부
  return (draft.courierCompany === "") === (draft.trackingNumber === "");
}

/** previewUrl은 blob URL이라 직렬화하지 않음 — null이면 read-url로 복원 */
export type RepairPhotoState = { objectKey: string; previewUrl: string | null };

export type RepairShipmentFormState = {
  courierCompany: string;
  trackingNumber: string;
  memo: string;
  photos: RepairPhotoState[];
};

export function emptyShipmentForm(): RepairShipmentFormState {
  return { courierCompany: "", trackingNumber: "", memo: "", photos: [] };
}

export function shipmentFormFromDraft(
  draft: RepairShipmentDraft | null,
): RepairShipmentFormState {
  if (!draft) return emptyShipmentForm();
  return {
    courierCompany: draft.courierCompany,
    trackingNumber: draft.trackingNumber,
    memo: draft.memo,
    photos: draft.photoObjectKeys.map((objectKey) => ({
      objectKey,
      previewUrl: null,
    })),
  };
}

/** 유효하면 draft, 아니면 null. 빈 폼(순수 발송 확인)도 유효.
 *  무효 조건: 택배사/송장번호 중 하나만 입력, 메모 500자 초과. */
export function shipmentDraftFromForm(
  state: RepairShipmentFormState,
): RepairShipmentDraft | null {
  const courierCompany = state.courierCompany.trim().toLowerCase();
  const trackingNumber = state.trackingNumber.trim();
  if ((courierCompany === "") !== (trackingNumber === "")) return null;
  if (state.memo.length > MAX_MEMO_LENGTH) return null;
  return {
    courierCompany,
    trackingNumber,
    memo: state.memo.trim(),
    photoObjectKeys: state.photos
      .slice(0, MAX_REPAIR_PHOTOS)
      .map((photo) => photo.objectKey),
  };
}

/** 결제·제출 게이트 helperText — 유효하면 null */
export function shipmentInvalidReason(
  state: RepairShipmentFormState,
): string | null {
  const courier = state.courierCompany.trim();
  const tracking = state.trackingNumber.trim();
  if (courier && !tracking) return "송장번호를 입력해 주세요.";
  if (!courier && tracking) return "택배사를 선택해 주세요.";
  if (state.memo.length > MAX_MEMO_LENGTH) {
    return "메모는 500자 이내로 입력해 주세요.";
  }
  return null;
}

/** 제출 바디 매핑 — 송장 있으면 tracking, 없으면 no-tracking(사유 없음). 빈 memo→null */
export function shipmentRequestBody(
  draft: RepairShipmentDraft,
):
  | { type: "tracking"; body: RepairTrackingRequest }
  | { type: "no-tracking"; body: RepairNoTrackingRequest } {
  const photos = draft.photoObjectKeys.map((object_key) => ({ object_key }));
  const memo = draft.memo || null;
  if (hasTracking(draft)) {
    return {
      type: "tracking",
      body: {
        courier_company: draft.courierCompany,
        tracking_number: draft.trackingNumber,
        memo,
        photos,
      },
    };
  }
  return { type: "no-tracking", body: { memo, photos } };
}
