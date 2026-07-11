import type { ShippingAddressOut } from "@essesion/api-client";
import {
  listAddressesOptions,
  listAddressesQueryKey,
  upsertAddressMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useZodForm } from "@/shared/lib/form";
import { CUSTOM_DELIVERY_REQUEST } from "../model/delivery-request";
import {
  AddressFormFields,
  addressFormDefaultValues,
  addressFormSchema,
} from "./address-form-fields";

export function AddressSelectModal({
  open,
  selected,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  selected: ShippingAddressOut | null;
  onOpenChange: (open: boolean) => void;
  onSelect: (address: ShippingAddressOut) => void;
}) {
  const queryClient = useQueryClient();
  const addressesQuery = useQuery(listAddressesOptions());
  const addresses = addressesQuery.data ?? [];
  const [creating, setCreating] = useState(false);
  const showForm =
    creating || (!addressesQuery.isPending && addresses.length === 0);
  const upsert = useMutation(upsertAddressMutation());
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useZodForm(addressFormSchema, {
    defaultValues: addressFormDefaultValues,
  });

  const close = () => {
    setCreating(false);
    reset();
    onOpenChange(false);
  };

  const save = handleSubmit(async (values) => {
    try {
      // 간이 폼의 자유 메모는 관리 폼의 "직접입력" 의미론으로 저장한다 —
      // request 없이 memo만 있으면 카드 표시·관리 폼 수정에서 유실된다.
      const memo = values.delivery_memo?.trim() || null;
      const address = await upsert.mutateAsync({
        body: {
          ...values,
          is_default: addresses.length === 0,
          delivery_request: memo ? CUSTOM_DELIVERY_REQUEST : null,
          delivery_memo: memo,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: listAddressesQueryKey(),
      });
      onSelect(address);
      close();
      snackbar("배송지를 저장했습니다.");
    } catch {
      snackbar("배송지를 저장하지 못했습니다.");
    }
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
      title={showForm ? "새 배송지" : "배송지 선택"}
      showCloseButton
      size="medium"
      footer={
        showForm ? (
          <HStack gap="x2">
            {addresses.length > 0 ? (
              <Box
                as={ActionButton}
                type="button"
                variant="neutralOutline"
                width="full"
                onClick={() => setCreating(false)}
              >
                목록
              </Box>
            ) : null}
            <Box
              as={ActionButton}
              type="button"
              width="full"
              loading={upsert.isPending}
              onClick={() => void save()}
            >
              저장
            </Box>
          </HStack>
        ) : (
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            onClick={() => setCreating(true)}
          >
            새 배송지 등록
          </Box>
        )
      }
    >
      {addressesQuery.isPending ? (
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="100%" height={64} />
          <Skeleton width="100%" height={64} />
        </VStack>
      ) : addressesQuery.isError ? (
        <ContentPlaceholder
          title="배송지를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          action={
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => void addressesQuery.refetch()}
            >
              다시 시도
            </ActionButton>
          }
        />
      ) : showForm ? (
        <form onSubmit={save}>
          <VStack gap="x4" alignItems="stretch">
            <AddressFormFields
              register={register}
              errors={errors}
              setValue={setValue}
            />
            <TextField label="배송 메모" {...register("delivery_memo")} />
          </VStack>
        </form>
      ) : (
        <SelectBox
          value={selected?.id ?? ""}
          onValueChange={(value) => {
            const address = addresses.find((item) => item.id === String(value));
            if (address) {
              onSelect(address);
              close();
            }
          }}
          aria-label="배송지"
        >
          {addresses.map((address) => (
            <SelectBoxItem
              key={address.id}
              value={address.id}
              label={`${address.recipient_name}${address.is_default ? " · 기본" : ""}`}
              description={`(${address.postal_code}) ${address.address} ${address.address_detail ?? ""}`}
            />
          ))}
        </SelectBox>
      )}
    </ResponsiveModal>
  );
}
