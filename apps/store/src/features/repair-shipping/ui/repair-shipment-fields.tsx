import { ListPicker, TextAreaField, TextField, VStack } from "@essesion/shared";
import { COURIER_OPTIONS } from "../model/couriers";
import type { RepairShipmentFormState } from "../model/shipment";
import { RepairPhotoField } from "./repair-photo-field";

/** 발송 확인 폼 — 모든 필드 선택. 송장은 택배사와 쌍으로만 유효.
 *  체크아웃·송장 등록 페이지 공용. */
export function RepairShipmentFields({
  state,
  onChange,
  onUploadingChange,
  disabled,
}: {
  state: RepairShipmentFormState;
  onChange: (next: RepairShipmentFormState) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<RepairShipmentFormState>) =>
    onChange({ ...state, ...patch });

  return (
    <VStack gap="x4" alignItems="stretch">
      <ListPicker
        label="택배사"
        placeholder="택배사 선택"
        options={COURIER_OPTIONS}
        value={state.courierCompany || undefined}
        onValueChange={(courierCompany) => set({ courierCompany })}
        disabled={disabled}
      />
      <TextField
        label="송장번호"
        placeholder="'-' 없이 숫자만 입력해 주세요"
        inputMode="numeric"
        description="송장번호를 입력해 두면 배송 사고 시 보상받기 쉬워요."
        value={state.trackingNumber}
        onChange={(event) => set({ trackingNumber: event.currentTarget.value })}
        disabled={disabled}
      />
      <RepairPhotoField
        photos={state.photos}
        onChange={(photos) => set({ photos })}
        onUploadingChange={onUploadingChange}
        disabled={disabled}
      />
      <TextAreaField
        label="메모"
        maxLength={500}
        value={state.memo}
        onChange={(event) => set({ memo: event.currentTarget.value })}
        disabled={disabled}
      />
    </VStack>
  );
}
