import type { ReactNode } from "react";
import { useEffect } from "react";

import { bootstrapSession } from "@/features/auth/model/bootstrap-session";
import { useCartAuthSync } from "@/features/cart";
import { useSession } from "@/shared/store/session";

/**
 * 앱 로드 시 세션 부트스트랩: refresh 쿠키가 있으면 액세스 토큰을 받아오고 유저를 로드한다.
 * 없으면 anonymous. 라우터 바깥에서 1회 실행.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useCartAuthSync();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapSession(() => cancelled);
    })().catch(() => {
      if (!cancelled) useSession.getState().clear();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
