import type { ShippingAddressOut } from "@essesion/api-client";
import {
  listAddressesQueryKey,
  upsertAddressMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Checkbox,
  ListPicker,
  ResponsiveModal,
  snackbar,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { useZodForm } from "@/shared/lib/form";
import {
  CUSTOM_DELIVERY_REQUEST,
  DELIVERY_REQUEST_OPTIONS,
} from "../model/delivery-request";
import {
  AddressFormFields,
  addressFormDefaultValues,
  addressFormSchema,
} from "./address-form-fields";

export function AddressFormModal({
  open,
  address,
  addressCount,
  onOpenChange,
}: {
  open: boolean;
  address: ShippingAddressOut | null;
  addressCount: number;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const upsert = useMutation(upsertAddressMutation());
  const isFirstAddress = address === null && addressCount === 0;
  const form = useZodForm(addressFormSchema, {
    defaultValues: addressFormDefaultValues,
  });
  const deliveryRequest = form.watch("delivery_request") ?? "";

  useEffect(() => {
    if (!open) return;
    form.reset(
      address
        ? {
            id: address.id,
            recipient_name: address.recipient_name,
            recipient_phone: address.recipient_phone,
            postal_code: address.postal_code,
            address: address.address,
            address_detail: address.address_detail ?? "",
            delivery_request: address.delivery_request ?? "",
            delivery_memo: address.delivery_memo ?? "",
            is_default: address.is_default,
          }
        : { ...addressFormDefaultValues, is_default: isFirstAddress },
    );
  }, [address, form, isFirstAddress, open]);

  const save = form.handleSubmit(async (values) => {
    try {
      await upsert.mutateAsync({
        body: {
          ...values,
          id: address?.id,
          is_default: isFirstAddress ? true : values.is_default,
          delivery_request: values.delivery_request || null,
          delivery_memo:
            values.delivery_request === CUSTOM_DELIVERY_REQUEST
              ? values.delivery_memo || null
              : null,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: listAddressesQueryKey(),
      });
      snackbar(address ? "배송지를 수정했습니다." : "배송지를 등록했습니다.");
      onOpenChange(false);
    } catch {
      snackbar("배송지를 저장하지 못했습니다.");
    }
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={address ? "배송지 수정" : "새 배송지 등록"}
      showCloseButton
      size="medium"
      footer={
        <Box
          as={ActionButton}
          type="button"
          width="full"
          loading={upsert.isPending}
          onClick={() => void save()}
        >
          저장
        </Box>
      }
    >
      <form onSubmit={save}>
        <VStack gap="x4" alignItems="stretch">
          <AddressFormFields
            register={form.register}
            errors={form.formState.errors}
            setValue={form.setValue}
          />
          <ListPicker
            label="배송 요청사항"
            options={DELIVERY_REQUEST_OPTIONS}
            value={deliveryRequest}
            onValueChange={(value) =>
              form.setValue("delivery_request", value, {
                shouldDirty: true,
                shouldValidate: true,
              })
            }
          />
          {deliveryRequest === CUSTOM_DELIVERY_REQUEST ? (
            <TextAreaField
              label="배송 메모"
              rows={3}
              maxLength={50}
              placeholder="최대 50자까지 입력할 수 있어요."
              {...form.register("delivery_memo")}
            />
          ) : null}
          <Checkbox
            label="기본 배송지"
            description={
              isFirstAddress
                ? "첫 배송지는 자동으로 기본 배송지가 됩니다."
                : address?.is_default
                  ? "다른 배송지를 기본으로 설정하면 변경됩니다."
                  : undefined
            }
            disabled={isFirstAddress || address?.is_default}
            checked={form.watch("is_default") ?? false}
            onChange={(event) =>
              form.setValue("is_default", event.currentTarget.checked, {
                shouldDirty: true,
              })
            }
          />
        </VStack>
      </form>
    </ResponsiveModal>
  );
}
