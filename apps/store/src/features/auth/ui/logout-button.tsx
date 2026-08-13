import { logoutMutation } from "@essesion/api-client/query";
import {
  ActionButton,
  type ActionButtonProps,
  AlertDialog,
  snackbar,
} from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { clearStoreSession } from "@/shared/lib/api-client";

type LogoutButtonProps = Pick<
  ActionButtonProps,
  "variant" | "size" | "className"
> & {
  children?: ReactNode;
};

/** 로그아웃 버튼 + 확인 AlertDialog. 헤더·마이페이지 등에서 재사용. */
export function LogoutButton({
  variant = "neutralOutline",
  size = "medium",
  className,
  children = "로그아웃",
}: LogoutButtonProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const logout = useMutation({
    ...logoutMutation(),
    onSettled: () => {
      clearStoreSession(true);
      snackbar("로그아웃되었습니다.");
      navigate("/", { replace: true });
    },
  });

  return (
    <>
      <ActionButton
        variant={variant}
        size={size}
        className={className}
        onClick={() => setOpen(true)}
      >
        {children}
      </ActionButton>
      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        title="로그아웃"
        description="로그아웃하시겠어요?"
        primaryActionProps={{
          children: "로그아웃",
          loading: logout.isPending,
          onClick: () => logout.mutate({}),
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </>
  );
}
