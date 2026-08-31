import { Flex, ProgressCircle, snackbar, Text } from "@essesion/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router";

import { bootstrapSession } from "@/features/auth/model/bootstrap-session";
import { consumeNaverAutologinAttempt } from "@/features/auth/model/naver-autologin";
import { takeAuthReturn } from "@/features/auth/model/return-after-login";
import { syncGuestCartToAccount } from "@/features/cart/model/use-cart";
import { trackEvent } from "@/shared/lib/analytics";

/** api가 ?error=로 넘기는 콜백 실패 코드 (docs/api-spec/domains.md §2). */
const OAUTH_ERROR_FALLBACK = "로그인에 실패했습니다. 다시 시도해 주세요.";
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "로그인이 취소되었습니다.",
  account_unavailable: "이 계정으로는 로그인할 수 없습니다.",
  server_error: OAUTH_ERROR_FALLBACK,
};

/**
 * OAuth 콜백 착지점. api가 refresh 쿠키를 심고 이 경로로 리다이렉트한다.
 * URL에 토큰은 없으므로 refresh로 액세스 토큰을 교환한 뒤 유저를 로드한다.
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;

    // api가 콜백 실패를 ?error=로 되돌린 경우 — 자동로그인 시도였으면 조용히 홈으로,
    // 아니면 사유별 안내 후 로그인으로.
    const error = new URLSearchParams(window.location.search).get("error");
    if (error !== null) {
      if (consumeNaverAutologinAttempt()) {
        navigate("/", { replace: true });
      } else {
        snackbar(OAUTH_ERROR_MESSAGES[error] ?? OAUTH_ERROR_FALLBACK);
        navigate("/login", { replace: true });
      }
      return;
    }

    (async () => {
      const ok = await bootstrapSession(() => cancelled);
      if (cancelled) return;
      if (!ok) {
        snackbar("로그인에 실패했습니다. 다시 시도해 주세요.");
        navigate("/login", { replace: true });
        return;
      }
      trackEvent("login", { method: "oauth" });
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
