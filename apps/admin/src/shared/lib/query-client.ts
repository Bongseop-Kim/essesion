import { QueryClient } from "@tanstack/react-query";

export function createAdminQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        retry: 1,
        staleTime: 30_000,
      },
      mutations: {
        retry: false,
      },
    },
  });
}
