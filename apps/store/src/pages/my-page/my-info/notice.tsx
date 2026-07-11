import {
  getMeOptions,
  getMeQueryKey,
  setNotificationPreferencesMutation,
  updateProfileMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  HStack,
  Skeleton,
  Switch,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { PhoneVerifyModal } from "@/features/my-page";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function NoticePage() {
  const queryClient = useQueryClient();
  const meQuery = useQuery(getMeOptions());
  const notification = useMutation(setNotificationPreferencesMutation());
  const marketing = useMutation(updateProfileMutation());
  const [phoneModalOpen, setPhoneModalOpen] = useState(false);
  const [enableAfterVerification, setEnableAfterVerification] = useState(false);

  const refreshMe = async () => {
    await queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
  };

  const setServiceNotifications = async (enabled: boolean) => {
    try {
      const me = await notification.mutateAsync({
        body: {
          notification_consent: enabled,
          notification_enabled: enabled,
        },
      });
      useSession.getState().setUser(me);
      await refreshMe();
      snackbar(enabled ? "서비스 알림을 켰습니다." : "서비스 알림을 껐습니다.");
    } catch {
      snackbar("서비스 알림 설정을 변경하지 못했습니다.");
    }
  };

  const setMarketingConsent = async (enabled: boolean) => {
    try {
      const me = await marketing.mutateAsync({
        body: { marketing_kakao_sms_consent: enabled },
      });
      useSession.getState().setUser(me);
      await refreshMe();
      snackbar(
        enabled
          ? "마케팅 수신에 동의했습니다."
          : "마케팅 수신 동의를 철회했습니다.",
      );
    } catch {
      snackbar("마케팅 수신 설정을 변경하지 못했습니다.");
    }
  };

  const serviceEnabled = Boolean(
    meQuery.data?.notification_consent && meQuery.data.notification_enabled,
  );

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "알림 설정" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x1">
          <Text as="h1" textStyle="title1">
            알림 설정
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            주문과 혜택 소식을 받을 채널을 관리하세요.
          </Text>
        </VStack>

        {meQuery.isPending ? (
          <VStack gap="x3" alignItems="stretch">
            <Skeleton width="100%" height={96} />
            <Skeleton width="100%" height={96} />
          </VStack>
        ) : meQuery.isError || !meQuery.data ? (
          <ContentPlaceholder
            title="알림 설정을 불러오지 못했습니다"
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
          <VStack gap="x4" alignItems="stretch">
            {!meQuery.data.phone_verified ? (
              <Callout
                tone="informative"
                title="휴대폰 인증이 필요합니다"
                description="서비스 알림을 켜면 먼저 휴대폰 인증을 진행합니다."
              />
            ) : null}
            <Box
              bg="bg.layer-default"
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              borderRadius="r3"
              p={{ base: "x4", md: "x5" }}
            >
              <HStack justify="space-between" gap="x4" align="flex-start">
                <VStack gap="x1" minWidth={0}>
                  <Text as="h2" textStyle="title3">
                    서비스 알림
                  </Text>
                  <Text textStyle="bodySm" color="fg.neutral-muted">
                    주문 상태와 꼭 필요한 안내를 카카오톡 또는 문자로 받습니다.
                  </Text>
                </VStack>
                <Switch
                  aria-label="서비스 알림"
                  checked={serviceEnabled}
                  disabled={notification.isPending}
                  onChange={(event) => {
                    const enabled = event.currentTarget.checked;
                    if (enabled && !meQuery.data.phone_verified) {
                      setEnableAfterVerification(true);
                      setPhoneModalOpen(true);
                      return;
                    }
                    void setServiceNotifications(enabled);
                  }}
                />
              </HStack>
            </Box>
            <Box
              bg="bg.layer-default"
              borderWidth={1}
              borderColor="stroke.neutral-weak"
              borderRadius="r3"
              p={{ base: "x4", md: "x5" }}
            >
              <HStack justify="space-between" gap="x4" align="flex-start">
                <VStack gap="x1" minWidth={0}>
                  <Text as="h2" textStyle="title3">
                    마케팅 수신 동의
                  </Text>
                  <Text textStyle="bodySm" color="fg.neutral-muted">
                    할인, 신상품, 이벤트 소식을 카카오톡 또는 문자로 받습니다.
                  </Text>
                </VStack>
                <Switch
                  aria-label="마케팅 수신 동의"
                  checked={meQuery.data.marketing_kakao_sms_consent}
                  disabled={marketing.isPending}
                  onChange={(event) =>
                    void setMarketingConsent(event.currentTarget.checked)
                  }
                />
              </HStack>
            </Box>
          </VStack>
        )}
      </VStack>

      <PhoneVerifyModal
        open={phoneModalOpen}
        currentPhone={meQuery.data?.phone}
        onOpenChange={(open) => {
          setPhoneModalOpen(open);
          if (!open) setEnableAfterVerification(false);
        }}
        onVerified={() => {
          if (enableAfterVerification) void setServiceNotifications(true);
          setEnableAfterVerification(false);
        }}
      />
    </ContentLayout>
  );
}
