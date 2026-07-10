import { Flex, ProgressCircle } from "@essesion/shared";
import { useEffect, useRef } from "react";
import { Outlet, useLocation, useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import { useSession } from "@/shared/store/session";

/** 소유자 전용 라우트 가드. 미인증이면 확인 후 로그인 페이지로 이동한다. */
export function ProtectedRoute() {
  const status = useSession((s) => s.status);
  const location = useLocation();
  const navigate = useNavigate();
  const { requireAuth } = useAuthGuard();
  const promptedPath = useRef<string | null>(null);
  const destinationPath = `${location.pathname}${location.search}`;

  useEffect(() => {
    if (status !== "anonymous") {
      promptedPath.current = null;
      return;
    }
    if (promptedPath.current === destinationPath) return;
    promptedPath.current = destinationPath;
    requireAuth({ path: destinationPath, state: location.state }, () => {
      if (location.key === "default") navigate("/", { replace: true });
      else navigate(-1);
    });
  }, [
    destinationPath,
    location.key,
    location.state,
    navigate,
    requireAuth,
    status,
  ]);

  if (status === "loading") {
    return (
      <Flex justify="center" py="x10">
        <ProgressCircle />
      </Flex>
    );
  }
  if (status === "anonymous") {
    return null;
  }
  return <Outlet />;
}
