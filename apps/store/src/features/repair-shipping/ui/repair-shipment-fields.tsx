import { ListPicker, TextAreaField, TextField, VStack } from "@essesion/shared";
import { COURIER_OPTIONS } from "../model/couriers";
import type { RepairShipmentFormState } from "../model/shipment";
import { RepairPhotoField } from "./repair-photo-field";

/** 발송 확인 폼 — 모든 필드 선택. 송장은 택배사와 쌍으로만 유효.
 *  체크아웃·송장 등록 페이지 공용.
 *  onChange는 변경분(patch)만 넘긴다 — 부모가 functional setState로 최신 폼 위에
 *  병합해야 늦게 끝난 사진 업로드가 그 사이 입력한 메모를 덮어쓰지 않는다. */
export function RepairShipmentFields({
  state,
  onChange,
  onUploadingChange,
  disabled,
}: {
  state: RepairShipmentFormState;
  onChange: (patch: Partial<RepairShipmentFormState>) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <VStack gap="x4" alignItems="stretch">
      <ListPicker
        label="택배사"
        placeholder="택배사 선택"
        options={COURIER_OPTIONS}
        value={state.courierCompany || undefined}
        onValueChange={(courierCompany) => onChange({ courierCompany })}
        disabled={disabled}
      />
      <TextField
        label="송장번호"
        placeholder="'-' 없이 숫자만 입력해 주세요"
        inputMode="numeric"
        description="송장번호를 입력해 두면 배송 사고 시 보상받기 쉬워요."
        value={state.trackingNumber}
        onChange={(event) =>
          onChange({ trackingNumber: event.currentTarget.value })
        }
        disabled={disabled}
      />
      <RepairPhotoField
        photos={state.photos}
        onChange={(photos) => onChange({ photos })}
        onUploadingChange={onUploadingChange}
        disabled={disabled}
      />
      <TextAreaField
        label="메모"
        maxLength={500}
        value={state.memo}
        onChange={(event) => onChange({ memo: event.currentTarget.value })}
        disabled={disabled}
      />
    </VStack>
  );
}
