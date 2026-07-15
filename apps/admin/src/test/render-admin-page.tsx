import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";

export function renderAdminPage(
  ui: ReactNode,
  { entry = "/" }: { entry?: string } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
    queryClient,
  };
}
