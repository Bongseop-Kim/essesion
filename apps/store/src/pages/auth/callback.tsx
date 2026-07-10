import { Flex, ProgressCircle, snackbar, Text } from "@essesion/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { bootstrapSession } from "@/features/auth/model/bootstrap-session";
import { takeAuthReturn } from "@/features/auth/model/return-after-login";
import { syncGuestCartToAccount } from "@/features/cart";

/**
 * OAuth 콜백 착지점. api가 refresh 쿠키를 심고 이 경로로 리다이렉트한다.
 * URL에 토큰은 없으므로 refresh로 액세스 토큰을 교환한 뒤 유저를 로드한다.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ok = await bootstrapSession(() => cancelled);
      if (cancelled) return;
      if (!ok) {
        snackbar("로그인에 실패했습니다. 다시 시도해 주세요.");
        navigate("/login", { replace: true });
        return;
      }
      const destination = takeAuthReturn() ?? { path: "/" };
      try {
        await syncGuestCartToAccount(queryClient);
        navigate(destination.path, {
          replace: true,
          state: destination.state,
        });
      } catch {
        navigate("/cart", { replace: true });
      }
    })().catch(() => {
      if (cancelled) return;
      snackbar("로그인 처리 중 오류가 발생했습니다.");
      navigate("/login", { replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, queryClient]);

  return (
    <Flex direction="column" align="center" gap="x4" py="x10">
      <ProgressCircle />
      <Text textStyle="body" color="fg.neutral-muted">
        로그인 처리 중…
      </Text>
    </Flex>
  );
}
