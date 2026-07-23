import { SnackbarHost } from "@essesion/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";

import {
  type AdminSessionAdapter,
  AdminSessionProvider,
} from "../../shared/session/admin-session";

export type AppProvidersProps = {
  sessionAdapter: AdminSessionAdapter;
  children: ReactNode;
};

export function AppProviders({ sessionAdapter, children }: AppProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { refetchOnWindowFocus: true, retry: 1, staleTime: 30_000 },
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
      <AdminSessionProvider
        adapter={sessionAdapter}
        clearSensitiveCache={clearSensitiveCache}
      >
        {children}
        <SnackbarHost />
      </AdminSessionProvider>
    </QueryClientProvider>
  );
}
