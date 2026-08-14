import {
  ActionButton,
  Box,
  canonicalizePhoneNumber,
  HStack,
  PhoneField,
  snackbar,
  TextField,
  VStack,
} from "@essesion/shared";
import type {
  Control,
  FieldErrors,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";
import { Controller } from "react-hook-form";
import { z } from "zod";

import { useDaumPostcode } from "../model/use-daum-postcode";

export const addressFormSchema = z.object({
  id: z.string().uuid().nullish(),
  recipient_name: z.string().trim().min(1, "받는 분을 입력해 주세요."),
  recipient_phone: z
    .string()
    .trim()
    .transform(canonicalizePhoneNumber)
    .refine(
      (value) => /^01\d{8,9}$/.test(value),
      "올바른 휴대폰 번호를 입력해 주세요.",
    ),
  postal_code: z.string().trim().min(1, "우편번호를 검색해 주세요."),
  address: z.string().trim().min(1, "주소를 검색해 주세요."),
  address_detail: z.string(),
  delivery_memo: z.string(),
  delivery_request: z.string(),
  is_default: z.boolean(),
});

export type AddressFormValues = z.input<typeof addressFormSchema>;

export const addressFormDefaultValues: AddressFormValues = {
  recipient_name: "",
  recipient_phone: "",
  postal_code: "",
  address: "",
  address_detail: "",
  delivery_memo: "",
  delivery_request: "",
  is_default: false,
};

export function AddressFormFields({
  register,
  control,
  errors,
  setValue,
}: {
  register: UseFormRegister<AddressFormValues>;
  control: Control<AddressFormValues>;
  errors: FieldErrors<AddressFormValues>;
  setValue: UseFormSetValue<AddressFormValues>;
}) {
  const postcode = useDaumPostcode();

  return (
    <VStack gap="x4" alignItems="stretch">
      <TextField
        label="받는 분"
        autoComplete="name"
        errorMessage={errors.recipient_name?.message}
        {...register("recipient_name")}
      />
      <Controller
        control={control}
        name="recipient_phone"
        render={({ field }) => (
          <PhoneField
            ref={field.ref}
            label="휴대폰 번호"
            value={field.value}
            errorMessage={errors.recipient_phone?.message}
            onBlur={field.onBlur}
            onValueChange={field.onChange}
          />
        )}
      />
      <HStack gap="x2" align="flex-end">
        <Box flexGrow minWidth={0}>
          <TextField
            label="우편번호"
            readOnly
            errorMessage={errors.postal_code?.message}
            {...register("postal_code")}
          />
        </Box>
        <ActionButton
          type="button"
          variant="neutralOutline"
          loading={postcode.loading}
          onClick={() =>
            void postcode
              .search(({ zonecode, address }) => {
                setValue("postal_code", zonecode, { shouldValidate: true });
                setValue("address", address, { shouldValidate: true });
                setValue("address_detail", "");
              })
              .catch(() => snackbar("주소 검색을 불러오지 못했습니다."))
          }
        >
          주소 검색
        </ActionButton>
      </HStack>
      <TextField
        label="주소"
        readOnly
        errorMessage={errors.address?.message}
        {...register("address")}
      />
      <TextField
        label="상세 주소"
        autoComplete="address-line2"
        {...register("address_detail")}
      />
    </VStack>
  );
}
