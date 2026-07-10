import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "react-router";

import { AuthProvider } from "@/app/providers/auth-provider";
import { router } from "@/app/router";
import { queryClient } from "@/shared/lib/query-client";

export function StoreApp() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  );
}
