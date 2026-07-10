import type { ShippingAddressOut } from "@essesion/api-client";
import {
  listAddressesOptions,
  listAddressesQueryKey,
  upsertAddressMutation,
} from "@essesion/api-client/query";
import { zShippingAddressIn } from "@essesion/api-client/zod";
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
import { z } from "zod";

import { useZodForm } from "@/shared/lib/form";
import { useDaumPostcode } from "../model/use-daum-postcode";

const addressSchema = zShippingAddressIn.extend({
  recipient_name: z.string().trim().min(1, "받는 분을 입력해 주세요."),
  recipient_phone: z
    .string()
    .trim()
    .regex(/^01\d{8,9}$/, "휴대폰 번호를 숫자만 입력해 주세요."),
  postal_code: z.string().trim().min(1, "우편번호를 검색해 주세요."),
  address: z.string().trim().min(1, "주소를 검색해 주세요."),
});

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
  const postcode = useDaumPostcode();
  const {
    register,
    handleSubmit,
    setValue,
    reset,
    formState: { errors },
  } = useZodForm(addressSchema, {
    defaultValues: {
      recipient_name: "",
      recipient_phone: "",
      postal_code: "",
      address: "",
      address_detail: "",
      delivery_memo: "",
      delivery_request: "",
      is_default: false,
    },
  });

  const close = () => {
    setCreating(false);
    reset();
    onOpenChange(false);
  };

  const save = handleSubmit(async (values) => {
    try {
      const address = await upsert.mutateAsync({
        body: { ...values, is_default: addresses.length === 0 },
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
            <TextField
              label="받는 분"
              autoComplete="name"
              errorMessage={errors.recipient_name?.message}
              {...register("recipient_name")}
            />
            <TextField
              label="휴대폰 번호"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="01012345678"
              errorMessage={errors.recipient_phone?.message}
              {...register("recipient_phone")}
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
                      setValue("postal_code", zonecode, {
                        shouldValidate: true,
                      });
                      setValue("address", address, { shouldValidate: true });
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
