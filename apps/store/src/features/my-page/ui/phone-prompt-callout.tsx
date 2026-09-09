import { setNotificationPreferences } from "@essesion/api-client";
import { getMeQueryKey } from "@essesion/api-client/query";
import { ActionButton, Callout, snackbar } from "@essesion/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useSession } from "@/shared/store/session";

import { PhoneVerifyModal } from "./phone-verify-modal";

/** 주문서·결제완료 화면에 노출하는 인라인 인증 유도. 저장 상태 없음 — 매 렌더 조건만 본다. */
export function PhonePromptCallout() {
  const user = useSession((state) => state.user);
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);

  if (!user || user.phone_verified) return null;

  // 인증이 끝나면 phone_verified=true로 이 컴포넌트가 unmount된다. 그래서 useMutation 대신
  // SDK를 직접 호출하고, 실패 재시도는 컴포넌트 밖에서도 살아 있는 snackbar action으로 준다.
  const setServiceNotifications = async (): Promise<void> => {
    try {
      const { data: me } = await setNotificationPreferences({
        body: { notification_consent: true, notification_enabled: true },
        throwOnError: true,
      });
      useSession.getState().setUser(me);
      await queryClient.invalidateQueries({ queryKey: getMeQueryKey() });
    } catch {
      snackbar("서비스 알림 설정을 변경하지 못했습니다.", {
        action: {
          label: "다시 시도",
          onClick: () => void setServiceNotifications(),
        },
      });
    }
  };

  return (
    <>
      <Callout
        tone="informative"
        title="주문·배송 진행 상황을 카카오톡으로 안내해드립니다"
        description="인증하지 않으면 주문·배송 진행 상태를 카카오톡으로 받을 수 없습니다."
      >
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="small"
          onClick={() => setModalOpen(true)}
        >
          인증하기
        </ActionButton>
      </Callout>
      <PhoneVerifyModal
        open={modalOpen}
        currentPhone={user.phone}
        onOpenChange={setModalOpen}
        onVerified={() => void setServiceNotifications()}
      />
    </>
  );
}
