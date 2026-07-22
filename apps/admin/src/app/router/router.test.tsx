import { render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminSession,
  AdminSessionAdapter,
} from "../../shared/session/admin-session";
import { AppProviders } from "../providers/app-providers";
import { adminRouteObjects } from "./router";

const adminSession: AdminSession = {
  userId: "admin-1",
  displayName: "운영자",
  role: "admin",
};

function readySessionAdapter(): AdminSessionAdapter {
  return {
    bootstrap: vi.fn(async () => adminSession),
    login: vi.fn(async () => adminSession),
    logout: vi.fn(async () => undefined),
  };
}

function renderRoute(path: string, adapter = readySessionAdapter()) {
  const router = createMemoryRouter(adminRouteObjects, {
    initialEntries: [path],
  });
  render(
    <AppProviders sessionAdapter={adapter}>
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
    const adapter: AdminSessionAdapter = {
      bootstrap: vi.fn(async () => null),
      login: vi.fn(async () => adminSession),
      logout: vi.fn(async () => undefined),
    };
    const router = renderRoute("/claims?page=2", adapter);

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.state).toEqual({ from: "/claims?page=2" });
    expect(
      await screen.findByRole("heading", { name: "관리자 로그인", level: 1 }),
    ).toBeTruthy();
  });
});
