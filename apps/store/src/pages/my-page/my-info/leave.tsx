import { deleteAccountMutation } from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Callout,
  Checkbox,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

export function LeavePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const removeAccount = useMutation(deleteAccountMutation());
  const [agreed, setAgreed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const leave = async () => {
    try {
      await removeAccount.mutateAsync({});
      useSession.getState().clear();
      queryClient.clear();
      snackbar("회원 탈퇴가 완료되었습니다.");
      navigate("/", { replace: true });
    } catch {
      snackbar("회원 탈퇴를 처리하지 못했습니다.");
    }
  };

  return (
    <ContentLayout
      breadcrumbs={[
        { label: "홈", href: "/" },
        { label: "마이페이지", href: "/my-page" },
        { label: "회원 탈퇴" },
      ]}
    >
      <VStack gap="x6" alignItems="stretch">
        <VStack gap="x1">
          <Text as="h1" textStyle="title1">
            회원 탈퇴
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            탈퇴 전에 아래 내용을 꼭 확인해 주세요.
          </Text>
        </VStack>

        <VStack gap="x3" alignItems="stretch">
          <Callout
            tone="critical"
            title="계정은 복구할 수 없습니다"
            description="탈퇴가 완료되면 현재 계정과 개인정보를 다시 되돌릴 수 없습니다."
          />
          <Callout
            tone="neutral"
            title="거래 정보는 법정 기간 동안 보관됩니다"
            description="주문과 결제 정보는 관련 법령에 따라 계정 정보와 분리해 최대 5년간 보관될 수 있습니다."
          />
          <Callout
            tone="neutral"
            title="다시 이용할 때 새 계정으로 처리될 수 있습니다"
            description="동일한 소셜 계정으로 로그인하더라도 이전 주문과 설정은 연결되지 않을 수 있습니다."
          />
          <Callout
            tone="neutral"
            title="작성 기록 일부는 남을 수 있습니다"
            description="문의와 견적 등 거래 관련 기록은 작성자 정보가 분리된 상태로 유지될 수 있습니다."
          />
        </VStack>

        <Checkbox
          label="탈퇴 유의사항을 모두 확인했으며 이에 동의합니다."
          checked={agreed}
          onChange={(event) => setAgreed(event.currentTarget.checked)}
        />
        <ActionButton
          type="button"
          variant="criticalSolid"
          disabled={!agreed}
          onClick={() => setConfirmOpen(true)}
        >
          회원 탈퇴
        </ActionButton>
      </VStack>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open && !removeAccount.isPending) setConfirmOpen(false);
        }}
        title="정말 탈퇴하시겠어요?"
        description="이 작업은 되돌릴 수 없습니다."
        primaryActionProps={{
          children: "탈퇴",
          variant: "criticalSolid",
          loading: removeAccount.isPending,
          onClick: (event) => {
            event.preventDefault();
            void leave();
          },
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </ContentLayout>
  );
}
