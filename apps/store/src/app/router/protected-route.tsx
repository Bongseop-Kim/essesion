import { Flex, ProgressCircle } from "@essesion/shared";
import { Navigate, Outlet, useLocation } from "react-router";

import { useSession } from "@/shared/store/session";

/** 소유자 전용 라우트 가드. 부트스트랩 중이면 대기, 미인증이면 /login으로. */
export function ProtectedRoute() {
  const status = useSession((s) => s.status);
  const location = useLocation();

  if (status === "loading") {
    return (
      <Flex justify="center" py="x10">
        <ProgressCircle />
      </Flex>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
