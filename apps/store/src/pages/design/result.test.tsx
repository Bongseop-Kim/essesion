// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const JOB = {
  id: "job-1",
  kind: "finalize",
  status: "succeeded",
  session_id: "session-1",
  created_at: "2026-10-13T00:00:00Z",
  result_url: null,
  tie_url: "https://cdn/tie.png",
  fabric_url: "https://cdn/fabric.png",
};

vi.mock("@/features/design/model/queries", () => ({
  latestFinalizedJobQueryOptions: ({
    sessionId,
    authenticated,
  }: {
    sessionId: string;
    authenticated: boolean;
  }) => ({
    queryKey: ["jobs", sessionId],
    queryFn: async () => [],
    enabled: authenticated,
  }),
}));

import { DesignResultPage } from "./result";

function OrderStub() {
  const { state } = useLocation();
  const jobs = (state as { designJobs: { id: string }[] }).designJobs;
  return <p>주문 {jobs.map((job) => job.id).join(",")}</p>;
}

function renderPage(state: unknown) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: "/design/sessions/session-1/result", state },
      ]}
    >
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route
            path="/design/sessions/:id/result"
            element={<DesignResultPage />}
          />
          <Route path="/design" element={<p>템플릿</p>} />
          <Route path="/design/sessions/:id/color" element={<p>색</p>} />
          <Route path="/custom-order" element={<OrderStub />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignResultPage", () => {
  beforeEach(() => {
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("실사 두 장을 보여주고 주문으로 완성본을 넘긴다", async () => {
    renderPage({ job: JOB });

    const tie = await screen.findByRole("img", { name: "넥타이 실사 이미지" });
    expect(tie.getAttribute("src")).toBe("https://cdn/tie.png");
    expect(
      screen.getByRole("img", { name: "원단 실사 이미지" }).getAttribute("src"),
    ).toBe("https://cdn/fabric.png");

    fireEvent.click(
      screen.getByRole("button", { name: "이 디자인으로 주문하기" }),
    );
    await screen.findByText("주문 job-1");
  });

  it("색·로고 다시 고르기는 색·로고 화면으로 간다", async () => {
    renderPage({ job: JOB });
    fireEvent.click(
      await screen.findByRole("button", { name: "색·로고 다시 고르기" }),
    );
    await screen.findByText("색");
  });

  it("완성본 없이 들어오면 색·로고 화면으로 안내한다", async () => {
    renderPage(null);
    await screen.findByText("아직 만든 결과가 없어요");
    fireEvent.click(screen.getByRole("button", { name: "색·로고 고르기" }));
    await screen.findByText("색");
  });
});
