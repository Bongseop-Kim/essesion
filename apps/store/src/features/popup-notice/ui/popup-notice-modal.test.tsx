// @vitest-environment jsdom
import {
  focusManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

const fetchPopup = vi.hoisted(() => vi.fn());
vi.mock("@essesion/api-client/query", () => ({
  getActivePopupOptions: () => ({
    queryKey: ["active-popup"],
    queryFn: fetchPopup,
  }),
}));
vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  Modal: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog">{children}</div>
  ),
}));

import { PopupNoticeModal } from "./popup-notice-modal";

Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});

afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("KST 자정에 null·만료·교체를 반영하고 창 복귀에도 조회한다", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-09T14:59:59Z"));
  const popup = {
    id: "first",
    template: "operation",
    title: "첫 안내",
    fields: { template: "operation", rows: [{ label: "시행", value: "오늘" }] },
  };
  fetchPopup.mockResolvedValue(null);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PopupNoticeModal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(10));
  expect(fetchPopup).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();

  fetchPopup.mockResolvedValue(popup);
  await act(() => vi.advanceTimersByTimeAsync(1000));
  expect(fetchPopup).toHaveBeenCalledTimes(2);
  expect(screen.getByText("첫 안내")).toBeTruthy();

  fetchPopup.mockResolvedValue({ ...popup, id: "second", title: "새 안내" });
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(10);
  });
  expect(screen.queryByText("첫 안내")).toBeNull();
  expect(screen.getByText("새 안내")).toBeTruthy();

  fetchPopup.mockResolvedValue(null);
  await act(() => vi.advanceTimersByTimeAsync(86_400_000));
  expect(screen.queryByRole("dialog")).toBeNull();
  client.clear();
});
