import type { AdminCouponOut } from "@essesion/api-client";
import { getAdminCouponOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  ContentPlaceholder,
  HStack,
  Skeleton,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
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
import { StatusBadge } from "../../shared/ui/status-badge";
import { CouponIssuedHistory } from "./issued-history";
import { CouponOperations } from "./operations";

function discountLabel(coupon: AdminCouponOut) {
  return coupon.discount_type === "percentage"
    ? `${Number(coupon.discount_value).toLocaleString("ko-KR")}%`
    : formatMoney(coupon.discount_value);
}

function CouponDetailLoading() {
  return (
    <VStack gap="x6" alignItems="stretch" aria-busy="true">
      <RouteHeading
        title="쿠폰 상세"
        description="쿠폰 정의와 발급 이력을 불러오고 있습니다."
      />
      <AdminCard title="쿠폰 정보">
        <VStack gap="x3" alignItems="stretch">
          <Skeleton width="60%" height={24} />
          <Skeleton width="100%" height={20} />
          <Skeleton width="80%" height={20} />
        </VStack>
      </AdminCard>
    </VStack>
  );
}

export function CouponDetailPage() {
  const { couponId = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useAdminSession();
  const canManage =
    state.status === "authenticated" && state.session.role === "admin";
  const query = useQuery({
    ...getAdminCouponOptions({ path: { coupon_id: couponId } }),
    enabled: couponId !== "",
  });
  const coupon = query.data;

  if (query.isLoading) return <CouponDetailLoading />;
  if (query.isError || coupon === undefined) {
    return (
      <VStack gap="x6" alignItems="stretch">
        <RouteHeading
          title="쿠폰 상세"
          description="쿠폰 정의와 발급 이력을 확인합니다."
        />
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

  return (
    <VStack gap="x6" alignItems="stretch">
      <HStack justify="space-between" align="flex-start" gap="x4" wrap>
        <RouteHeading
          title={coupon.name}
          description={`마지막 수정 ${formatDateTime(coupon.updated_at)}`}
        />
        <HStack gap="x2" align="center" wrap>
          <StatusBadge status={coupon.is_active ? "active" : "inactive"} />
          <ActionButton variant="ghost" onClick={() => navigate("/coupons")}>
            목록으로
          </ActionButton>
          {canManage && (
            <ActionButton
              variant="neutralWeak"
              onClick={() => navigate(`/coupons/${coupon.id}/edit`)}
            >
              수정
            </ActionButton>
          )}
        </HStack>
      </HStack>

      <AdminCard title="쿠폰 요약">
        <DetailList
          items={[
            { label: "고객 표시 이름", value: coupon.display_name ?? "-" },
            { label: "할인 조건", value: discountLabel(coupon) },
            {
              label: "최대 할인액",
              value: formatMoney(coupon.max_discount_amount),
            },
            { label: "만료일 (KST)", value: formatDate(coupon.expiry_date) },
            {
              label: "활성 발급 / 전체 발급",
              value: `${coupon.active_issued_count.toLocaleString("ko-KR")} / ${coupon.issued_count.toLocaleString("ko-KR")}건`,
            },
            { label: "등록 시각", value: formatDateTime(coupon.created_at) },
          ]}
        />
      </AdminCard>

      <Tabs defaultValue="definition">
        <TabList aria-label="쿠폰 상세 메뉴">
          <TabTrigger value="definition">쿠폰 정의</TabTrigger>
          <TabTrigger value="operations">발급 운영</TabTrigger>
          <TabTrigger value="history">발급 이력</TabTrigger>
        </TabList>
        <TabContent value="definition">
          <VStack gap="x5" pt="x5" alignItems="stretch">
            <AdminCard title="쿠폰 정의">
              <DetailList
                items={[
                  { label: "이름", value: coupon.name },
                  {
                    label: "고객 표시 이름",
                    value: coupon.display_name ?? "-",
                  },
                  {
                    label: "할인 방식",
                    value:
                      coupon.discount_type === "percentage"
                        ? "정률 할인"
                        : "정액 할인",
                  },
                  { label: "할인 값", value: discountLabel(coupon) },
                  {
                    label: "최대 할인액",
                    value: formatMoney(coupon.max_discount_amount),
                  },
                  {
                    label: "만료일 (KST)",
                    value: formatDate(coupon.expiry_date),
                  },
                  {
                    label: "설명",
                    value:
                      coupon.description === null || coupon.description === ""
                        ? "-"
                        : coupon.description,
                  },
                  {
                    label: "추가 안내",
                    value:
                      coupon.additional_info === null ||
                      coupon.additional_info === ""
                        ? "-"
                        : coupon.additional_info,
                  },
                  {
                    label: "상태",
                    value: coupon.is_active ? "활성" : "비활성",
                  },
                ]}
              />
            </AdminCard>
          </VStack>
        </TabContent>
        <TabContent value="operations">
          <VStack pt="x5" alignItems="stretch">
            <CouponOperations
              couponId={coupon.id}
              couponActive={coupon.is_active}
              couponExpiry={formatDate(coupon.expiry_date)}
              canManage={canManage}
            />
          </VStack>
        </TabContent>
        <TabContent value="history">
          <VStack pt="x5" alignItems="stretch">
            <CouponIssuedHistory couponId={coupon.id} canManage={canManage} />
          </VStack>
        </TabContent>
      </Tabs>
    </VStack>
  );
}
