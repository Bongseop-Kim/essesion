import { listMyClaimsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  ContentPlaceholder,
  List,
  ListHeader,
  ListItem,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import {
  type ClaimListType,
  claimItemTitle,
  claimReasonLabel,
  claimStatusTone,
  claimTypeLabel,
} from "@/features/claims";
import { groupByCreatedDate } from "@/shared/lib/date-groups";
import { ChipFilterBar } from "@/shared/ui/chip-filter-bar";
import { ContentLayout } from "@/shared/ui/content-layout";

type ClaimFilter = "all" | ClaimListType;

const CLAIM_FILTERS: readonly { value: ClaimFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "cancel", label: "취소" },
  { value: "return", label: "반품" },
  { value: "exchange", label: "교환" },
  { value: "token_refund", label: "토큰 환불" },
];

export function ClaimListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const claimsQuery = useQuery(listMyClaimsOptions());
  const claims = (claimsQuery.data ?? []).filter(
    (claim) => filter === "all" || claim.type === filter,
  );
  const groups = groupByCreatedDate(claims);

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "클레임 내역" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <Text as="h1" textStyle="title1">
          취소·반품·교환 내역
        </Text>

        <ChipFilterBar
          filters={CLAIM_FILTERS}
          value={filter}
          onChange={setFilter}
        />

        {claimsQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="100%" height={88} />
            <Skeleton width="100%" height={88} />
          </VStack>
        ) : claimsQuery.isError ? (
          <ContentPlaceholder
            title="클레임 내역을 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => void claimsQuery.refetch()}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : claims.length === 0 ? (
          <ContentPlaceholder
            title={
              filter === "all"
                ? "클레임 내역이 없습니다"
                : "해당 내역이 없습니다"
            }
            description="주문 상세에서 취소·반품·교환을 신청할 수 있습니다."
            action={
              filter === "all" ? (
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  onClick={() => navigate("/my-page/orders")}
                >
                  주문 내역 보기
                </ActionButton>
              ) : undefined
            }
          />
        ) : (
          <VStack gap="x4" alignItems="stretch">
            {groups.map(([date, dateClaims]) => (
              <VStack key={date} gap="x1" alignItems="stretch">
                <ListHeader variant="boldSolid">{date}</ListHeader>
                <List>
                  {dateClaims.map((claim) => (
                    <ListItem
                      key={claim.id}
                      title={`${claimTypeLabel(claim.type)} · ${claim.claim_number}`}
                      description={`${claim.order_number} · ${claimItemTitle(claim.item)} · ${claimReasonLabel(claim.reason)}`}
                      suffix={
                        <Badge tone={claimStatusTone(claim.status)}>
                          {claim.status}
                        </Badge>
                      }
                      onClick={() => navigate(`/my-page/claims/${claim.id}`)}
                    />
                  ))}
                </List>
              </VStack>
            ))}
          </VStack>
        )}
      </VStack>
    </ContentLayout>
  );
}
