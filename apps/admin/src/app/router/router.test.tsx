import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import type {
  AdminSession,
  AdminSessionAdapter,
} from "../../shared/session/admin-session";
import { unavailableAdminSessionAdapter } from "../../shared/session/admin-session";
import { AppProviders } from "../providers/app-providers";
import { adminRouteObjects } from "./router";

const adminSession: AdminSession = {
  userId: "admin-1",
  displayName: "운영자",
  role: "admin",
};

function readySessionAdapter(): AdminSessionAdapter {
  return {
    availability: "ready",
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
  it("legacy 상세 주소를 canonical lazy route로 보낸다", async () => {
    const router = renderRoute("/orders/show/ORDER-1");

    expect(
      await screen.findByRole("heading", { name: "주문 상세", level: 1 }),
    ).toBeTruthy();
    expect(router.state.location.pathname).toBe("/orders/ORDER-1");
    expect(document.title).toBe("주문 상세 | ESSE SION 관리자");

    const sidebar = screen.getByRole("navigation", { name: "관리자 메뉴" });
    expect(
      within(sidebar)
        .getByRole("link", { name: "주문 관리" })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(
      screen.getByRole("link", { name: "본문으로 건너뛰기" }),
    ).toBeTruthy();
    expect(screen.getByRole("main")).toBeTruthy();
  });

  it("알 수 없는 주소는 셸 안의 404를 표시한다", async () => {
    renderRoute("/unknown-admin-page");
    expect(
      await screen.findByRole("heading", {
        name: "페이지를 찾을 수 없습니다",
        level: 1,
      }),
    ).toBeTruthy();
  });

  it("인증 결선 전에는 보호 라우트를 fail closed로 유지한다", async () => {
    renderRoute("/orders", unavailableAdminSessionAdapter);
    expect(await screen.findByText("관리자 인증 연결 대기")).toBeTruthy();
    expect(
      screen.queryByRole("navigation", { name: "관리자 메뉴" }),
    ).toBeNull();
  });

  it("익명 세션은 로그인으로 복귀 경로를 전달한다", async () => {
    const adapter: AdminSessionAdapter = {
      availability: "ready",
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
