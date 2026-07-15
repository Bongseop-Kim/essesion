import { listMyOrdersOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Chip,
  ContentPlaceholder,
  HStack,
  List,
  ListHeader,
  ListItem,
  ScrollFog,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { claimBadge } from "@/features/claims";
import { orderStatusTone, orderTypeLabel } from "@/features/orders";
import { krw } from "@/pages/shop/constants";
import { groupByCreatedDate } from "@/shared/lib/date-groups";
import { ContentLayout } from "@/shared/ui/content-layout";

type OrderTypeFilter =
  | "all"
  | "sale"
  | "repair"
  | "custom"
  | "sample"
  | "token";

const ORDER_TYPE_FILTERS: readonly { value: OrderTypeFilter; label: string }[] =
  [
    { value: "all", label: "전체" },
    { value: "sale", label: "일반구매" },
    { value: "repair", label: "수선" },
    { value: "custom", label: "주문제작" },
    { value: "sample", label: "샘플" },
    { value: "token", label: "토큰" },
  ];

export function OrderListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<OrderTypeFilter>("all");
  const ordersQuery = useQuery(
    filter === "all"
      ? listMyOrdersOptions()
      : listMyOrdersOptions({ query: { order_type: filter } }),
  );
  const orders = ordersQuery.data ?? [];
  const groups = groupByCreatedDate(orders);

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "주문 내역" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <Text as="h1" textStyle="title1">
          주문 내역
        </Text>

        <ScrollFog direction="horizontal">
          <HStack gap="x2">
            {ORDER_TYPE_FILTERS.map((option) => (
              <Chip
                key={option.value}
                selected={filter === option.value}
                onClick={() => setFilter(option.value)}
              >
                {option.label}
              </Chip>
            ))}
          </HStack>
        </ScrollFog>

        {ordersQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="100%" height={64} />
            <Skeleton width="100%" height={64} />
            <Skeleton width="100%" height={64} />
          </VStack>
        ) : ordersQuery.isError ? (
          <ContentPlaceholder
            title="주문 내역을 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => void ordersQuery.refetch()}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : orders.length === 0 ? (
          <ContentPlaceholder
            title={
              filter === "all" ? "주문 내역이 없습니다" : "해당 주문이 없습니다"
            }
            description={
              filter === "all"
                ? "첫 주문을 시작해 보세요."
                : "다른 유형을 선택해 보세요."
            }
            action={
              filter === "all" ? (
                <ActionButton type="button" onClick={() => navigate("/shop")}>
                  스토어 둘러보기
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <VStack gap="x4" alignItems="stretch">
            {groups.map(([date, dateOrders]) => (
              <VStack key={date} gap="x1" alignItems="stretch">
                <ListHeader variant="boldSolid">{date}</ListHeader>
                <List>
                  {dateOrders.map((order) => {
                    const claim = order.claim_summary
                      ? claimBadge(order.claim_summary)
                      : null;
                    return (
                      <ListItem
                        key={order.id}
                        title={`${orderTypeLabel(order.order_type)} · ${order.order_number}`}
                        description={`${krw.format(order.total_price)}원 · 상품 ${order.items?.length ?? 0}개`}
                        suffix={
                          <HStack gap="x1" wrap>
                            <Badge tone={orderStatusTone(order.status)}>
                              {order.status}
                            </Badge>
                            {claim ? (
                              <Badge tone={claim.tone}>{claim.label}</Badge>
                            ) : null}
                          </HStack>
                        }
                        onClick={() => navigate(`/order/${order.id}`)}
                      />
                    );
                  })}
                </List>
              </VStack>
            ))}
          </VStack>
        )}
      </VStack>
    </ContentLayout>
  );
}
