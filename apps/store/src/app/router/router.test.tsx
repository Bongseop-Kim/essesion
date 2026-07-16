import { describe, expect, it, vi } from "vitest";

vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  createBrowserRouter: vi.fn(() => ({})),
}));

vi.mock("@/shared/lib/observability", () => ({
  captureRouteError: vi.fn(),
}));

describe("store router", () => {
  // 전체 스위트 병렬 실행 시 라우트 모듈 동적 import가 5초 기본 타임아웃을 넘길 수 있다
  it("root 오류 경계와 진짜 404 페이지를 제공한다", {
    timeout: 20_000,
  }, async () => {
    const { storeRouteObjects } = await import("./index");
    const { RouteErrorBoundary } = await import("./route-error");
    const { NotFoundPage } = await import("@/pages/not-found");
    const root = storeRouteObjects[0];
    expect(root).toBeDefined();
    if (root === undefined) throw new Error("store root route is missing");

    expect(root.errorElement?.type).toBe(RouteErrorBoundary);
    const notFound = root.children.find((route) => route.path === "*");
    expect(notFound?.element?.type).toBe(NotFoundPage);
  });
});
