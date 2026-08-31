import type { ReactNode } from "react";
import { useEffect } from "react";

import { bootstrapSession } from "@/features/auth/model/bootstrap-session";
import { attemptNaverAutologin } from "@/features/auth/model/naver-autologin";
import { useCartAuthSync } from "@/features/cart/model/use-cart";
import { clearStoreSession } from "@/shared/lib/api-client";

/**
 * 앱 로드 시 세션 부트스트랩: refresh 쿠키가 있으면 액세스 토큰을 받아오고 유저를 로드한다.
 * 없으면 anonymous — 단 네이버앱 재방문자는 자동로그인을 1회 시도한다(§5.1).
 * 라우터 바깥에서 1회 실행.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useCartAuthSync();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const authenticated = await bootstrapSession(() => cancelled);
      if (!cancelled && !authenticated) attemptNaverAutologin();
    })().catch(() => {
      if (!cancelled) clearStoreSession();
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return <>{children}</>;
}
