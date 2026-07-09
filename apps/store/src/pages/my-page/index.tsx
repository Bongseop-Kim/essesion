import { getMeOptions } from "@essesion/api-client/query";
import { Flex, ProgressCircle, Text, VStack } from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";

import { LogoutButton } from "@/features/auth";

export function MyPage() {
  // 보호 GET — Bearer 주입 + 401 시 refresh 재시도 배선을 실제로 태운다.
  const { data: me, isPending } = useQuery(getMeOptions());

  return (
    <Flex justify="center" px={{ base: "x4", md: "x8" }} py="x10">
      <VStack gap="x6" width="full" maxWidth={640}>
        <Text as="h1" textStyle="title1">
          마이페이지
        </Text>

        {isPending ? (
          <ProgressCircle />
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

        <LogoutButton variant="neutralOutline" />
      </VStack>
    </Flex>
  );
}
