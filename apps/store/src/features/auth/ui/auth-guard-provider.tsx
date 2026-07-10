import { AlertDialog } from "@essesion/shared";
import {
  createContext,
  type ReactNode,
  use,
  useCallback,
  useState,
} from "react";
import { useNavigate } from "react-router";

import {
  type AuthReturn,
  saveAuthReturn,
} from "@/features/auth/model/return-after-login";
import { useSession } from "@/shared/store/session";

type AuthRequest = {
  destination: AuthReturn;
  onCancel?: () => void;
};

type AuthGuardContextValue = {
  requireAuth: (destination: AuthReturn, onCancel?: () => void) => boolean;
};

const AuthGuardContext = createContext<AuthGuardContextValue | null>(null);

export function AuthGuardProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const status = useSession((state) => state.status);
  const [request, setRequest] = useState<AuthRequest | null>(null);

  const requireAuth = useCallback(
    (destination: AuthReturn, onCancel?: () => void) => {
      if (status === "authenticated") return true;
      if (status === "anonymous") setRequest({ destination, onCancel });
      return false;
    },
    [status],
  );

  const cancel = () => {
    const onCancel = request?.onCancel;
    setRequest(null);
    onCancel?.();
  };

  const confirm = () => {
    if (!request) return;
    saveAuthReturn(request.destination);
    setRequest(null);
    navigate("/login", { state: { from: request.destination.path } });
  };

  return (
    <AuthGuardContext value={{ requireAuth }}>
      {children}
      <AlertDialog
        open={request != null}
        onOpenChange={(open) => {
          if (!open) cancel();
        }}
        title="로그인이 필요합니다"
        description="로그인 페이지로 이동할까요?"
        primaryActionProps={{
          children: "로그인하기",
          onClick: (event) => {
            event.preventDefault();
            confirm();
          },
        }}
        secondaryActionProps={{
          children: "취소",
          variant: "neutralOutline",
        }}
      />
    </AuthGuardContext>
  );
}

export function useAuthGuard() {
  const context = use(AuthGuardContext);
  if (!context) {
    throw new Error("useAuthGuard는 AuthGuardProvider 안에서 사용해야 합니다.");
  }
  return context;
}
