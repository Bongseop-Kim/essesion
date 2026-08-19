import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      // "always"는 staleTime을 무시하고 포커스마다 전부 재요청한다.
      // 항상 신선해야 하는 쿼리는 live-queries.ts의 FOCUS_REFETCH로 opt-in.
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
});
