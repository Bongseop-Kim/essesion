import type { ShippingAddressOut } from "@essesion/api-client";
import {
  deleteAddressMutation,
  listAddressesOptions,
  listAddressesQueryKey,
  upsertAddressMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { AddressFormModal, deliveryRequestLabel } from "@/features/shipping";
import { ContentLayout } from "@/shared/ui/content-layout";

export function ShippingPage() {
  const queryClient = useQueryClient();
  const addressesQuery = useQuery(listAddressesOptions());
  const addresses = addressesQuery.data ?? [];
  const [formOpen, setFormOpen] = useState(false);
  const [editingAddress, setEditingAddress] =
    useState<ShippingAddressOut | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShippingAddressOut | null>(
    null,
  );
  const [defaultingId, setDefaultingId] = useState<string | null>(null);
  const upsert = useMutation(upsertAddressMutation());
  const remove = useMutation(deleteAddressMutation());

  const openForm = (address: ShippingAddressOut | null) => {
    setEditingAddress(address);
    setFormOpen(true);
  };

  const setDefault = async (address: ShippingAddressOut) => {
    setDefaultingId(address.id);
    try {
      await upsert.mutateAsync({
        body: {
          id: address.id,
          recipient_name: address.recipient_name,
          recipient_phone: address.recipient_phone,
          postal_code: address.postal_code,
          address: address.address,
          address_detail: address.address_detail,
          delivery_request: address.delivery_request,
          delivery_memo: address.delivery_memo,
          is_default: true,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: listAddressesQueryKey(),
      });
      snackbar("기본 배송지를 변경했습니다.");
    } catch {
      snackbar("기본 배송지를 변경하지 못했습니다.");
    } finally {
      setDefaultingId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove.mutateAsync({ path: { address_id: deleteTarget.id } });
      await queryClient.invalidateQueries({
        queryKey: listAddressesQueryKey(),
      });
      setDeleteTarget(null);
      snackbar("배송지를 삭제했습니다.");
    } catch {
      snackbar("배송지를 삭제하지 못했습니다.");
    }
  };

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "배송지 관리" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <HStack justify="space-between" gap="x4" align="flex-start">
          <VStack gap="x1">
            <Text as="h1" textStyle="title1">
              배송지 관리
            </Text>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              주문에 사용할 배송지를 등록하고 관리하세요.
            </Text>
          </VStack>
          {addresses.length > 0 ? (
            <ActionButton
              type="button"
              variant="neutralOutline"
              onClick={() => openForm(null)}
            >
              새 배송지 등록
            </ActionButton>
          ) : null}
        </HStack>

        {addressesQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="100%" height={156} />
            <Skeleton width="100%" height={156} />
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
        ) : addresses.length === 0 ? (
          <ContentPlaceholder
            title="등록된 배송지가 없습니다"
            description="첫 배송지는 자동으로 기본 배송지가 됩니다."
            action={
              <ActionButton type="button" onClick={() => openForm(null)}>
                배송지 등록
              </ActionButton>
            }
          />
        ) : (
          <VStack gap="x3" alignItems="stretch">
            {addresses.map((address) => {
              const request = deliveryRequestLabel(
                address.delivery_request,
                address.delivery_memo,
              );
              return (
                <Box
                  key={address.id}
                  bg="bg.layer-default"
                  borderWidth={1}
                  borderColor="stroke.neutral-weak"
                  borderRadius="r3"
                  p={{ base: "x4", md: "x5" }}
                >
                  <VStack gap="x4" alignItems="stretch">
                    <VStack gap="x2">
                      <HStack gap="x2" wrap>
                        <Text as="h2" textStyle="title3">
                          {address.recipient_name}
                        </Text>
                        {address.is_default ? <Badge>기본</Badge> : null}
                      </HStack>
                      <Text textStyle="bodySm">{address.recipient_phone}</Text>
                      <Text textStyle="bodySm" color="fg.neutral-muted">
                        ({address.postal_code}) {address.address}{" "}
                        {address.address_detail ?? ""}
                      </Text>
                      {request ? (
                        <Text textStyle="caption" color="fg.neutral-muted">
                          배송 요청: {request}
                        </Text>
                      ) : null}
                    </VStack>
                    <HStack gap="x2" wrap>
                      <ActionButton
                        type="button"
                        size="small"
                        variant="neutralOutline"
                        onClick={() => openForm(address)}
                      >
                        수정
                      </ActionButton>
                      {!address.is_default ? (
                        <>
                          <ActionButton
                            type="button"
                            size="small"
                            variant="neutralOutline"
                            loading={defaultingId === address.id}
                            onClick={() => void setDefault(address)}
                          >
                            기본으로 설정
                          </ActionButton>
                          <ActionButton
                            type="button"
                            size="small"
                            variant="ghost"
                            onClick={() => setDeleteTarget(address)}
                          >
                            삭제
                          </ActionButton>
                        </>
                      ) : null}
                    </HStack>
                  </VStack>
                </Box>
              );
            })}
          </VStack>
        )}
      </VStack>

      <AddressFormModal
        open={formOpen}
        address={editingAddress}
        addressCount={addresses.length}
        onOpenChange={setFormOpen}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleteTarget(null);
        }}
        title="배송지 삭제"
        description={`${deleteTarget?.recipient_name ?? "선택한"} 배송지를 삭제하시겠어요?`}
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: remove.isPending,
          onClick: (event) => {
            event.preventDefault();
            void confirmDelete();
          },
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </ContentLayout>
  );
}
