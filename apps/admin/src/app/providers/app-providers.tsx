import { SnackbarHost } from "@essesion/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";

import { AdminSessionProvider } from "../../shared/session/admin-session";

export type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // staleTime 30초라 탭 복귀 시 30초 지난 데이터만 재요청된다 —
            // 잡 모니터링 화면도 이 주기면 충분해 별도 opt-in 없음.
            refetchOnWindowFocus: true,
            retry: 1,
            staleTime: 30_000,
          },
          mutations: { retry: false },
        },
      }),
  );
  const clearSensitiveCache = useCallback(
    () => queryClient.clear(),
    [queryClient],
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AdminSessionProvider clearSensitiveCache={clearSensitiveCache}>
        {children}
        <SnackbarHost />
      </AdminSessionProvider>
    </QueryClientProvider>
  );
}
