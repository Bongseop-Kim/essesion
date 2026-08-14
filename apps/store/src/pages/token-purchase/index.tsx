import type { TokenPlan } from "@essesion/api-client";
import { getTokenPlansOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import {
  type TokenPurchaseDraft,
  tokenPlanLabel,
} from "@/features/token-purchase/model/config";
import { krw } from "@/pages/shop/constants";
import { tokenBalanceQueryOptions } from "@/shared/lib/live-queries";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

/** 응답 내 가장 비싼 토큰당 단가를 기준선으로 각 플랜의 보너스 비율(%)을 낸다. */
export function bonusPercent(plan: TokenPlan, plans: readonly TokenPlan[]) {
  const rate = (item: TokenPlan) => item.price / item.token_amount;
  const baseline = Math.max(...plans.map(rate));
  return Math.round((baseline / rate(plan) - 1) * 100);
}

export function TokenPurchasePage() {
  const navigate = useNavigate();
  const { requireAuth } = useAuthGuard();
  const authenticated = useSession((state) => state.status) === "authenticated";
  const plansQuery = useQuery(getTokenPlansOptions());
  const balanceQuery = useQuery(tokenBalanceQueryOptions(authenticated));
  const [selectedPlanKey, setSelectedPlanKey] = useState<string | null>(null);
  const balance = balanceQuery.data;

  const selectPlan = (plan: TokenPlan) => {
    setSelectedPlanKey(plan.plan_key);
    const draft: TokenPurchaseDraft = { plan };
    if (
      requireAuth({
        path: "/token/purchase/payment",
        state: { tokenPurchase: draft },
      })
    ) {
      navigate("/token/purchase/payment", {
        state: { tokenPurchase: draft },
      });
    } else {
      snackbar("로그인 후 선택한 플랜의 결제를 이어갈 수 있습니다.");
    }
  };

  return (
    <ContentLayout
      breadcrumbs={[{ label: "홈", href: "/" }, { label: "토큰 충전" }]}
    >
      <Box maxWidth={1024} mx="auto">
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="center">
            <Text as="h1" textStyle="title1" align="center">
              토큰 충전
            </Text>
            <Text textStyle="body" color="fg.neutral-muted" align="center">
              디자인 생성에 사용할 토큰을 필요한 만큼 충전해 보세요.
            </Text>
            {authenticated ? (
              balanceQuery.isPending ? (
                <Skeleton width={180} height={28} />
              ) : balanceQuery.isError ? (
                <Text textStyle="caption" color="fg.critical">
                  현재 잔액을 불러오지 못했습니다.
                </Text>
              ) : (
                <Badge variant="outline">
                  현재 잔액 {krw.format(balanceQuery.data?.total ?? 0)} 토큰
                </Badge>
              )
            ) : (
              <Badge variant="outline">로그인 후 잔액 확인</Badge>
            )}
          </VStack>

          {/* 단가는 관리자가 바꿀 수 있어 상수로 박지 않고 잔액 응답 값을 쓴다. */}
          <Callout
            title="토큰 사용 안내"
            description={`구매 토큰은 결제일로부터 1년간 사용할 수 있습니다.${
              balance
                ? ` 처음 만들기 ${krw.format(balance.generate_cost)}토큰, 고치기 ${krw.format(balance.edit_cost)}토큰, 새 무늬 만들기 ${krw.format(balance.motif_generate_cost)}토큰을 씁니다.`
                : ""
            }`}
          />

          {plansQuery.isPending ? (
            <Grid columns={{ base: 1, sm: 3 }} gap="x5">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} width="100%" height={280} />
              ))}
            </Grid>
          ) : plansQuery.isError ? (
            <ContentPlaceholder
              title="토큰 플랜을 불러오지 못했습니다"
              description="잠시 후 다시 시도해 주세요."
              action={
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  onClick={() => void plansQuery.refetch()}
                >
                  다시 시도
                </ActionButton>
              }
            />
          ) : plansQuery.data?.length ? (
            <Grid columns={{ base: 1, sm: 3 }} gap="x5">
              {plansQuery.data.map((plan) => (
                <PlanCard
                  key={plan.plan_key}
                  plan={plan}
                  bonus={bonusPercent(plan, plansQuery.data)}
                  selected={selectedPlanKey === plan.plan_key}
                  onSelect={() => selectPlan(plan)}
                />
              ))}
            </Grid>
          ) : (
            <ContentPlaceholder
              title="이용 가능한 플랜이 없습니다"
              description="플랜이 준비되면 이 화면에서 안내해 드립니다."
            />
          )}
        </VStack>
      </Box>
    </ContentLayout>
  );
}

function PlanCard({
  plan,
  bonus,
  selected,
  onSelect,
}: {
  plan: TokenPlan;
  bonus: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const popular = plan.plan_key === "popular";
  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
      borderRadius="r4"
      p={{ base: "x5", md: "x6" }}
      boxShadow={popular ? "s2" : "s1"}
    >
      <VStack gap="x5" alignItems="stretch" height="full">
        <VStack gap="x2">
          <Box alignSelf="flex-start">
            <Badge variant={popular ? "solid" : "outline"}>
              {popular ? "가장 많이 선택" : tokenPlanLabel(plan.plan_key)}
            </Badge>
          </Box>
          <Text as="h2" textStyle="title2">
            {tokenPlanLabel(plan.plan_key)}
          </Text>
          <Text textStyle="title1">{krw.format(plan.token_amount)} 토큰</Text>
          <Text textStyle="body" color="fg.neutral-muted">
            {krw.format(plan.price)}원
          </Text>
          {bonus >= 1 ? (
            <Text textStyle="caption" color="fg.positive">
              보너스 +{bonus}%
            </Text>
          ) : null}
        </VStack>
        <Box mt="auto">
          <Box
            as={ActionButton}
            type="button"
            width="full"
            variant={popular ? "brandSolid" : "neutralOutline"}
            onClick={onSelect}
          >
            이 플랜 선택
          </Box>
        </Box>
      </VStack>
    </Box>
  );
}
