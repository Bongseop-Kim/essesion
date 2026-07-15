import type { AdminCouponOut } from "@essesion/api-client";
import {
  getAdminCouponOptions,
  getAdminCouponQueryKey,
  listAdminCouponsQueryKey,
  updateAdminCouponMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  ContentPlaceholder,
  HStack,
  Skeleton,
  snackbar,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";

import {
  formatDate,
  formatDateTime,
  formatMoney,
} from "../../shared/lib/format";
import { useAdminSession } from "../../shared/session/admin-session";
import { AdminCard } from "../../shared/ui/admin-card";
import { DetailList } from "../../shared/ui/detail-list";
import { RouteHeading } from "../../shared/ui/route-heading";
import {
  CouponDefinitionForm,
  type CouponDraft,
  couponDraftBody,
} from "./coupon-form";

function draftFromCoupon(coupon: AdminCouponOut): CouponDraft {
  return {
    name: coupon.name,
    displayName: coupon.display_name ?? "",
    discountType: coupon.discount_type === "fixed" ? "fixed" : "percentage",
    discountValue: String(Number(coupon.discount_value)),
    maxDiscountAmount:
      coupon.max_discount_amount === null
        ? ""
        : String(Number(coupon.max_discount_amount)),
    expiryDate: coupon.expiry_date,
    description: coupon.description ?? "",
    additionalInfo: coupon.additional_info ?? "",
    isActive: coupon.is_active,
  };
}

function discountLabel(coupon: AdminCouponOut) {
  return coupon.discount_type === "percentage"
    ? `${Number(coupon.discount_value).toLocaleString("ko-KR")}%`
    : formatMoney(coupon.discount_value);
}

function CouponEditLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="쿠폰 수정"
        description="쿠폰 정의를 불러오고 있습니다."
      />
      <AdminCard title="쿠폰 정의">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

export function CouponEditPage() {
  const { couponId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { state } = useAdminSession();
  const canManage =
    state.status === "authenticated" && state.session.role === "admin";
  const [resetSignal, setResetSignal] = useState(0);
  const [showServerComparison, setShowServerComparison] = useState(false);
  const [reloadConfirmOpen, setReloadConfirmOpen] = useState(false);
  const query = useQuery({
    ...getAdminCouponOptions({ path: { coupon_id: couponId } }),
    enabled: couponId !== "" && canManage,
  });
  const mutation = useMutation({
    ...updateAdminCouponMutation(),
    onSuccess: async (coupon) => {
      snackbar("쿠폰 정의를 저장했습니다.");
      queryClient.setQueryData(
        getAdminCouponQueryKey({ path: { coupon_id: couponId } }),
        coupon,
      );
      await queryClient.invalidateQueries({
        queryKey: listAdminCouponsQueryKey(),
      });
      navigate(`/coupons/${couponId}`);
    },
  });
  const coupon = query.data;
  const initialDraft = useMemo(
    () => (coupon === undefined ? undefined : draftFromCoupon(coupon)),
    [coupon],
  );

  if (!canManage) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="쿠폰 수정" description="쿠폰 정의를 수정합니다." />
        <ContentPlaceholder
          title="쿠폰 수정 권한이 없습니다"
          description="관리자 역할만 쿠폰 정의를 수정할 수 있습니다."
          action={
            <ActionButton onClick={() => navigate(`/coupons/${couponId}`)}>
              상세로 돌아가기
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  if (query.isLoading) return <CouponEditLoading />;
  if (query.isError || coupon === undefined || initialDraft === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading title="쿠폰 수정" description="쿠폰 정의를 수정합니다." />
        <ContentPlaceholder
          title="쿠폰을 불러오지 못했습니다"
          description="쿠폰 ID를 확인하거나 다시 시도해 주세요."
          action={
            <ActionButton onClick={() => void query.refetch()}>
              다시 시도
            </ActionButton>
          }
        />
      </VStack>
    );
  }

  const compareServer = async () => {
    await query.refetch();
    setShowServerComparison(true);
  };
  const resetFromServer = async () => {
    const result = await query.refetch();
    if (result.data === undefined) return;
    mutation.reset();
    setShowServerComparison(false);
    setResetSignal((current) => current + 1);
  };

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={`${coupon.name} 수정`}
          description={`마지막 수정 ${formatDateTime(coupon.updated_at)}`}
        />
        <ActionButton
          variant="ghost"
          onClick={() => navigate(`/coupons/${coupon.id}`)}
        >
          상세로
        </ActionButton>
      </HStack>

      <CouponDefinitionForm
        initial={initialDraft}
        revision={coupon.updated_at}
        resetSignal={resetSignal}
        submitLabel="쿠폰 변경 저장"
        pending={mutation.isPending}
        error={mutation.error}
        errorAction={
          <HStack gap="x2" wrap>
            <ActionButton
              variant="neutralOutline"
              loading={query.isFetching}
              onClick={() => void compareServer()}
            >
              최신 서버 값 비교
            </ActionButton>
            <ActionButton
              variant="ghost"
              onClick={() => setReloadConfirmOpen(true)}
            >
              서버 값으로 초기화
            </ActionButton>
          </HStack>
        }
        onSubmit={(draft, revision) => {
          if (revision === undefined) return;
          mutation.mutate({
            path: { coupon_id: coupon.id },
            body: {
              ...couponDraftBody(draft),
              expected_updated_at: revision,
            },
          });
        }}
      />

      {showServerComparison && (
        <AdminCard
          title="현재 서버 값"
          description={`서버 revision ${coupon.updated_at}`}
        >
          <DetailList
            items={[
              { label: "이름", value: coupon.name },
              { label: "할인 조건", value: discountLabel(coupon) },
              {
                label: "최대 할인액",
                value: formatMoney(coupon.max_discount_amount),
              },
              { label: "만료일", value: formatDate(coupon.expiry_date) },
              { label: "상태", value: coupon.is_active ? "활성" : "비활성" },
            ]}
          />
        </AdminCard>
      )}

      <AlertDialog
        open={reloadConfirmOpen}
        onOpenChange={setReloadConfirmOpen}
        title="입력한 변경을 서버 값으로 초기화할까요?"
        description="현재 입력은 사라지고 최신 저장 값으로 돌아갑니다."
        primaryActionProps={{
          children: "서버 값 불러오기",
          variant: "criticalSolid",
          onClick: () => void resetFromServer(),
        }}
        secondaryActionProps={{ children: "계속 편집" }}
      />
    </VStack>
  );
}
