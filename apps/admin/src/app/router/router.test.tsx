import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminSession } from "../../shared/session/admin-session";
import { AppProviders } from "../providers/app-providers";
import { adminRouteObjects } from "./router";

const sessionMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
}));

vi.mock("../../shared/session/api-admin-session", () => ({
  bootstrapAdminSession: sessionMocks.bootstrap,
  loginAdminSession: sessionMocks.login,
  logoutAdminSession: sessionMocks.logout,
  subscribeAdminSession: sessionMocks.subscribe,
}));

const adminSession: AdminSession = {
  userId: "admin-1",
  displayName: "운영자",
  role: "admin",
};

beforeEach(() => {
  sessionMocks.bootstrap.mockReset().mockResolvedValue(adminSession);
  sessionMocks.login.mockReset().mockResolvedValue(adminSession);
  sessionMocks.logout.mockReset().mockResolvedValue(undefined);
  sessionMocks.subscribe.mockClear();
});

function renderRoute(path: string) {
  const router = createMemoryRouter(adminRouteObjects, {
    initialEntries: [path],
  });
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

describe("admin router", () => {
  it("알 수 없는 주소는 셸 안의 404를 표시한다", async () => {
    renderRoute("/unknown-admin-page");
    expect(
      await screen.findByRole("heading", {
        name: "페이지를 찾을 수 없습니다",
        level: 1,
      }),
    ).toBeTruthy();
  });

  it("익명 세션은 로그인으로 복귀 경로를 전달한다", async () => {
    sessionMocks.bootstrap.mockResolvedValueOnce(null);
    const router = renderRoute("/claims?page=2");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.state).toEqual({ from: "/claims?page=2" });
    expect(
      await screen.findByRole("heading", { name: "관리자 로그인", level: 1 }),
    ).toBeTruthy();
  });
});
