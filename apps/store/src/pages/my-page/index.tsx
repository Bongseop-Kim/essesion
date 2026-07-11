import { getMeOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  List,
  ListHeader,
  ListItem,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { LogoutButton } from "@/features/auth";
import { ContentLayout } from "@/shared/ui/content-layout";

export function MyPage() {
  const navigate = useNavigate();
  const meQuery = useQuery(getMeOptions());
  const me = meQuery.data;

  const sidebar = me ? (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p="x5"
    >
      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title3">
          계정 상태
        </Text>
        <VStack gap="x3" alignItems="stretch">
          <HStack justify="space-between" gap="x3">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              휴대폰 인증
            </Text>
            <Badge tone={me.phone_verified ? "positive" : "neutral"}>
              {me.phone_verified ? "완료" : "미인증"}
            </Badge>
          </HStack>
          <HStack justify="space-between" gap="x3">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              서비스 알림
            </Text>
            <Badge
              tone={
                me.notification_consent && me.notification_enabled
                  ? "positive"
                  : "neutral"
              }
            >
              {me.notification_consent && me.notification_enabled
                ? "수신"
                : "미수신"}
            </Badge>
          </HStack>
          <HStack justify="space-between" gap="x3">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              마케팅 정보
            </Text>
            <Badge
              tone={me.marketing_kakao_sms_consent ? "positive" : "neutral"}
            >
              {me.marketing_kakao_sms_consent ? "동의" : "미동의"}
            </Badge>
          </HStack>
        </VStack>
        {!me.phone_verified ? (
          <Text textStyle="caption" color="fg.neutral-muted">
            휴대폰을 인증하면 주문 상태 알림을 받을 수 있습니다.
          </Text>
        ) : null}
      </VStack>
    </Box>
  ) : meQuery.isPending ? (
    <Skeleton width="100%" height={196} />
  ) : undefined;

  return (
    <ContentLayout
      breadcrumbs={[{ label: "홈", href: "/" }, { label: "마이페이지" }]}
      sidebar={sidebar}
    >
      <VStack gap="x6" alignItems="stretch">
        <Text as="h1" textStyle="title1">
          마이페이지
        </Text>

        {meQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width={160} height={30} />
            <Skeleton width={240} height={22} />
            <Skeleton width={180} height={22} />
          </VStack>
        ) : meQuery.isError || !me ? (
          <ContentPlaceholder
            title="계정 정보를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => void meQuery.refetch()}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : (
          <Box
            bg="bg.neutral-weak"
            borderRadius="r3"
            p={{ base: "x4", md: "x5" }}
          >
            <VStack gap="x1">
              <Text as="h2" textStyle="title2">
                {me.name}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {me.email ?? "이메일 정보 없음"}
              </Text>
              <Text textStyle="bodySm" color="fg.neutral-muted">
                {me.phone ?? "휴대폰 번호를 등록해 주세요."}
              </Text>
            </VStack>
          </Box>
        )}

        {me ? (
          <VStack gap="x5" alignItems="stretch">
            <VStack gap="x2" alignItems="stretch">
              <ListHeader variant="boldSolid">주문과 내역</ListHeader>
              <List>
                <ListItem
                  title="주문 내역"
                  description="주문 상태와 수선품 발송 현황을 확인합니다."
                  onClick={() => navigate("/my-page/orders")}
                />
                <ListItem
                  title="취소·반품·교환 내역"
                  description="클레임 신청과 처리 상태를 확인합니다."
                  onClick={() => navigate("/my-page/claims")}
                />
                <ListItem
                  title="견적 요청 내역"
                  description="주문 제작 견적 요청과 안내 내용을 확인합니다."
                  onClick={() => navigate("/my-page/quote-request")}
                />
                <ListItem
                  title="토큰 내역"
                  description="구매 및 환불에 따른 토큰 변동을 확인합니다."
                  onClick={() => navigate("/my-page/token-history")}
                />
              </List>
            </VStack>
            <VStack gap="x2" alignItems="stretch">
              <ListHeader variant="boldSolid">고객지원</ListHeader>
              <List>
                <ListItem
                  title="자주 묻는 질문"
                  description="배송, 주문, 수선과 제작 서비스 이용 방법을 확인합니다."
                  onClick={() => navigate("/faq")}
                />
                <ListItem
                  title="공지사항"
                  description="서비스 운영과 정책 변경 소식을 확인합니다."
                  onClick={() => navigate("/notice")}
                />
                <ListItem
                  title="1:1 문의 내역"
                  description="문의 작성과 답변 상태를 확인합니다."
                  onClick={() => navigate("/my-page/inquiry")}
                />
              </List>
            </VStack>
            <VStack gap="x2" alignItems="stretch">
              <ListHeader variant="boldSolid">설정</ListHeader>
              <List>
                <ListItem
                  title="내 정보"
                  description="이름, 생년월일, 휴대폰 인증을 관리합니다."
                  onClick={() => navigate("/my-page/my-info")}
                />
                <ListItem
                  title="배송지 관리"
                  description="주문에 사용할 배송지를 등록하고 수정합니다."
                  onClick={() => navigate("/my-page/shipping")}
                />
                <ListItem
                  title="알림 설정"
                  description="서비스와 마케팅 알림 수신 여부를 관리합니다."
                  onClick={() => navigate("/my-page/my-info/notice")}
                />
              </List>
            </VStack>
            <LogoutButton variant="neutralOutline" />
          </VStack>
        ) : null}
      </VStack>
    </ContentLayout>
  );
}
