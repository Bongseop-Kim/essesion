import { logoutMutation } from "@essesion/api-client/query";
import { snackbar } from "@essesion/shared";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { clearStoreSession } from "@/shared/lib/api-client";

/** 로그아웃 — 서버 쿠키 폐기 + 로컬 세션 정리(성공/실패 무관) 후 홈으로. */
export function useLogout() {
  const navigate = useNavigate();
  const mutation = useMutation({
    ...logoutMutation(),
    onSettled: () => {
      clearStoreSession(true);
      snackbar("로그아웃되었습니다.");
      navigate("/", { replace: true });
    },
  });
  return { logout: () => mutation.mutate({}), isPending: mutation.isPending };
}
