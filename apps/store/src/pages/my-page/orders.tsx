import { listMyOrdersOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  ContentPlaceholder,
  List,
  ListItem,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import {
  formatOrderDate,
  orderStatusTone,
  orderTypeLabel,
} from "@/features/orders";
import { krw } from "@/pages/shop/constants";
import { ContentLayout } from "@/shared/ui/content-layout";

export function OrderListPage() {
  const navigate = useNavigate();
  const ordersQuery = useQuery(listMyOrdersOptions());
  const orders = ordersQuery.data ?? [];

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
            title="주문 내역이 없습니다"
            description="첫 주문을 시작해 보세요."
            action={
              <ActionButton type="button" onClick={() => navigate("/shop")}>
                스토어 둘러보기
              </ActionButton>
            }
          />
        ) : (
          <List>
            {orders.map((order) => (
              <ListItem
                key={order.id}
                title={`${orderTypeLabel(order.order_type)} · ${order.order_number}`}
                description={`${formatOrderDate(order.created_at)} · ${krw.format(order.total_price)}원`}
                suffix={
                  <Badge tone={orderStatusTone(order.status)}>
                    {order.status}
                  </Badge>
                }
                onClick={() => navigate(`/order/${order.id}`)}
              />
            ))}
          </List>
        )}
      </VStack>
    </ContentLayout>
  );
}
