import {
  ActionButton,
  type ActionButtonProps,
  AlertDialog,
} from "@essesion/shared";
import type { ReactNode } from "react";
import { useState } from "react";

import { useLogout } from "@/features/auth/model/use-logout";

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
  const { logout, isPending } = useLogout();

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
          loading: isPending,
          onClick: logout,
        }}
        secondaryActionProps={{ children: "취소" }}
      />
    </>
  );
}
