import {
  ActionButton,
  ContentPlaceholder,
  Layout,
  LayoutContent,
} from "@essesion/shared";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import {
  type AdminRole,
  SessionBootstrapPending,
  useAdminSession,
} from "../../shared/session/admin-session";

export type ProtectedRouteProps = {
  allowedRoles: readonly AdminRole[];
  children: ReactNode;
};

function GuardPage({ children }: { children: ReactNode }) {
  return (
    <Layout bg="bg.layer-basement">
      <LayoutContent as="main" density="low" py="x12">
        {children}
      </LayoutContent>
    </Layout>
  );
}

export function ProtectedRoute({
  allowedRoles,
  children,
}: ProtectedRouteProps) {
  const location = useLocation();
  const { state, retryBootstrap } = useAdminSession();

  if (state.status === "loading") {
    return (
      <GuardPage>
        <SessionBootstrapPending />
      </GuardPage>
    );
  }

  if (state.status === "error") {
    return (
      <GuardPage>
        <ContentPlaceholder
          title="세션을 확인하지 못했습니다"
          description="네트워크 상태를 확인한 뒤 다시 시도해 주세요."
          action={
            <ActionButton variant="neutralWeak" onClick={retryBootstrap}>
              다시 시도
            </ActionButton>
          }
        />
      </GuardPage>
    );
  }

  if (state.status === "anonymous") {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return (
      <Navigate to="/login" replace state={{ from }} /> // harness-ignore -- 관리자 보호 라우트의 단일 로그인 게이트
    );
  }

  if (!allowedRoles.includes(state.session.role)) {
    return (
      <GuardPage>
        <ContentPlaceholder
          title="접근 권한이 없습니다"
          description="이 작업에 필요한 관리자 역할이 없습니다."
        />
      </GuardPage>
    );
  }

  return children;
}
