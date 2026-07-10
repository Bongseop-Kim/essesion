import { getMeOptions } from "@essesion/api-client/query";
import {
  ContentPlaceholder,
  Flex,
  List,
  ListItem,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { LogoutButton } from "@/features/auth";

export function MyPage() {
  const navigate = useNavigate();
  // 보호 GET — Bearer 주입 + 401 시 refresh 재시도 배선을 실제로 태운다.
  const { data: me, isPending, isError } = useQuery(getMeOptions());

  return (
    <Flex justify="center" px={{ base: "x4", md: "x8" }} py="x10">
      <VStack gap="x6" width="full" maxWidth={640}>
        <Text as="h1" textStyle="title1">
          마이페이지
        </Text>

        {isPending ? (
          <VStack gap="x2" width="full">
            <Skeleton width={64} height={19} />
            <Skeleton width={180} height={22} />
            <Skeleton width={64} height={19} />
            <Skeleton width={120} height={22} />
          </VStack>
        ) : isError ? (
          <ContentPlaceholder
            title="정보를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
          />
        ) : (
          <VStack gap="x2">
            <Text textStyle="labelSm" color="fg.neutral-muted">
              이메일
            </Text>
            <Text textStyle="body">{me?.email ?? "-"}</Text>
            <Text textStyle="labelSm" color="fg.neutral-muted">
              이름
            </Text>
            <Text textStyle="body">{me?.name ?? "-"}</Text>
          </VStack>
        )}

        <List>
          <ListItem
            title="주문 내역"
            description="주문 상태 확인과 수선품 발송 확인"
            onClick={() => navigate("/my-page/orders")}
          />
        </List>

        <LogoutButton variant="neutralOutline" />
      </VStack>
    </Flex>
  );
}
