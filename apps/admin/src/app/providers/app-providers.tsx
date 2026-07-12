import { SnackbarHost } from "@essesion/shared";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";

import { createAdminQueryClient } from "../../shared/lib/query-client";
import {
  type AdminSessionAdapter,
  AdminSessionProvider,
} from "../../shared/session/admin-session";

export type AppProvidersProps = {
  sessionAdapter: AdminSessionAdapter;
  children: ReactNode;
};

export function AppProviders({ sessionAdapter, children }: AppProvidersProps) {
  const [queryClient] = useState(createAdminQueryClient);
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
