import { getMe } from "@essesion/api-client";

import {
  clearStoreSession,
  refreshStoreAccessToken,
  setStoreAccessToken,
} from "@/shared/lib/api-client";
import { useSession } from "@/shared/store/session";

export async function bootstrapSession(
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  try {
    const token = await refreshStoreAccessToken();
    if (isCancelled()) return false;
    if (!token) {
      clearStoreSession();
      return false;
    }

    // 다른 탭의 refresh 결과를 Web Lock 안에서 재사용한 경우에도 이 탭의
    // Zustand 세션은 getMe 전에 명시적으로 최신 토큰을 받는다.
    setStoreAccessToken(token);
    const me = await getMe();
    if (isCancelled()) return false;
    if (!me.data) {
      clearStoreSession();
      return false;
    }

    useSession.getState().setUser(me.data);
    return true;
  } catch (error) {
    clearStoreSession();
    throw error;
  }
}
