import type { OrderDetailOut, OrderItemOut } from "@essesion/api-client";
import {
  createClaimMutation,
  getOrderQueryKey,
  listMyClaimsQueryKey,
  listMyOrdersQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Callout,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  snackbar,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  CLAIM_TYPE_CONFIG,
  type ClaimReason,
  type ClaimType,
  claimItemTitle,
  claimReasonLabel,
} from "../model/config";

type ClaimFormModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: ClaimType;
  order: OrderDetailOut;
  item: OrderItemOut;
};

export function ClaimFormModal({
  open,
  onOpenChange,
  type,
  order,
  item,
}: ClaimFormModalProps) {
  const queryClient = useQueryClient();
  const config = CLAIM_TYPE_CONFIG[type];
  const [reason, setReason] = useState<ClaimReason | "">("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState(String(item.quantity));
  const parsedQuantity = Number(quantity);
  const quantityInvalid =
    !Number.isInteger(parsedQuantity) ||
    parsedQuantity < 1 ||
    parsedQuantity > item.quantity;

  const createClaim = useMutation({
    ...createClaimMutation(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listMyClaimsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: getOrderQueryKey({ path: { order_id: order.id } }),
        }),
        queryClient.invalidateQueries({ queryKey: listMyOrdersQueryKey() }),
      ]);
      onOpenChange(false);
      snackbar(`${config.label} 요청을 접수했습니다.`);
    },
    onError: () => {
      snackbar(
        `${config.label} 요청을 접수하지 못했습니다. 다시 시도해 주세요.`,
      );
    },
  });

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={`${config.label} 요청`}
      description={`${order.order_number} · ${claimItemTitle(item)}`}
      showCloseButton
      footer={
        <ActionButton
          type="button"
          size="large"
          loading={createClaim.isPending}
          disabled={!reason || quantityInvalid}
          onClick={() => {
            if (!reason || quantityInvalid) return;
            createClaim.mutate({
              body: {
                type,
                order_id: order.id,
                item_id: item.item_id,
                reason,
                description: description.trim() || null,
                quantity: parsedQuantity,
              },
            });
          }}
        >
          {config.label} 요청하기
        </ActionButton>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        {item.quantity > 1 ? (
          <TextField
            type="number"
            min={1}
            max={item.quantity}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            label="요청 수량"
            description={`최대 ${item.quantity}개`}
            errorMessage={
              quantityInvalid ? "요청 가능한 수량을 입력해 주세요." : undefined
            }
            disabled={createClaim.isPending}
          />
        ) : null}

        <VStack gap="x2" alignItems="stretch">
          <Text textStyle="label">요청 사유</Text>
          <RadioGroup
            value={reason}
            onValueChange={(value) => setReason(value as ClaimReason)}
            disabled={createClaim.isPending}
            aria-label="요청 사유"
          >
            {config.reasons.map((value) => (
              <RadioGroupItem
                key={value}
                value={value}
                label={claimReasonLabel(value)}
              />
            ))}
          </RadioGroup>
        </VStack>

        <TextAreaField
          label="상세 내용"
          description={`${description.length}/500자`}
          maxLength={500}
          rows={4}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="확인에 필요한 내용을 입력해 주세요."
          disabled={createClaim.isPending}
        />

        <Callout tone="neutral" title="신청 전 확인해 주세요">
          <VStack gap="x1">
            {config.notices.map((notice) => (
              <Text key={notice} textStyle="caption">
                · {notice}
              </Text>
            ))}
          </VStack>
        </Callout>
      </VStack>
    </ResponsiveModal>
  );
}
