import { getMe, refreshTokens } from "@essesion/api-client";

import { useSession } from "@/shared/store/session";

export async function bootstrapSession(
  isCancelled: () => boolean = () => false,
): Promise<boolean> {
  try {
    const { data } = await refreshTokens();
    const token = data?.access_token ?? null;
    if (isCancelled()) return false;
    if (!token) {
      useSession.getState().clear();
      return false;
    }

    useSession.getState().setAccessToken(token);
    const me = await getMe();
    if (isCancelled()) return false;
    if (!me.data) {
      useSession.getState().clear();
      return false;
    }

    useSession.getState().setUser(me.data);
    return true;
  } catch (error) {
    useSession.getState().clear();
    throw error;
  }
}
