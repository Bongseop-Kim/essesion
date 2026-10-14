// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const api = vi.hoisted(() => ({
  placeLogo: vi.fn(),
  finalize: vi.fn(),
}));
const ui = vi.hoisted(() => ({ snackbar: vi.fn() }));

const SESSION = {
  id: "session-1",
  preview_svg: "<svg/>",
  colorway: "default",
  current_intent: { colorways: [] },
  current_motifs: [{ motif_id: "m-dots" }, { motif_id: "m-bee" }],
};
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

vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar: ui.snackbar,
}));
vi.mock("@essesion/api-client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/api-client")>()),
  placeDesignLogo: api.placeLogo,
  createFinalizeJob: api.finalize,
}));
vi.mock("@/features/design/model/queries", () => ({
  designSessionQueryKey: (id: string) => ["session", id],
  designSessionQueryOptions: ({ sessionId }: { sessionId: string }) => ({
    queryKey: ["session", sessionId],
    queryFn: async () => SESSION,
  }),
}));
vi.mock("@/shared/lib/live-queries", () => ({
  designExamplesQueryOptions: () => ({
    queryKey: ["examples"],
    queryFn: async () => [],
  }),
  tokenBalanceQueryOptions: () => ({
    queryKey: ["balance"],
    queryFn: async () => ({ total: 455, finalize_cost: 200 }),
  }),
}));

import { DesignLogoPage } from "./logo";

function ResultStub() {
  const { state } = useLocation();
  return <p>결과 {(state as { job: { id: string } }).job.id}</p>;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
  render(
    <MemoryRouter initialEntries={["/design/sessions/session-1/logo"]}>
      <QueryClientProvider client={queryClient}>
        <Routes>
          <Route
            path="/design/sessions/:id/logo"
            element={<DesignLogoPage />}
          />
          <Route path="/design/sessions/:id/result" element={<ResultStub />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("DesignLogoPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    URL.createObjectURL = vi.fn(() => "blob:logo");
    // jsdom의 File에는 arrayBuffer가 없다 — SVG 읽기 경로가 쓴다.
    if (!File.prototype.arrayBuffer) {
      File.prototype.arrayBuffer = function arrayBuffer() {
        return new Promise<ArrayBuffer>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as ArrayBuffer);
          reader.readAsArrayBuffer(this);
        });
      };
    }
    URL.revokeObjectURL = vi.fn();
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

  it("SVG 로고를 올리고 생성하면 한 번에 넣은 뒤 실사화하고 결과로 간다", async () => {
    api.placeLogo.mockResolvedValue({ data: { warnings: [] } });
    api.finalize.mockResolvedValue({ data: JOB });
    renderPage();

    const generate = await screen.findByRole("button", { name: "생성" });
    expect((generate as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/200토큰/)).toBeTruthy();

    const input = document.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error("no file input");
    const file = new File(["<svg id='logo'/>"], "acme.svg", {
      type: "image/svg+xml",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "생성" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "생성" }));

    // 슬롯은 서버가 정한다 — 화면은 이름·SVG만 보낸다.
    await waitFor(() =>
      expect(api.placeLogo).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { name: "acme", svg: "<svg id='logo'/>" },
        throwOnError: true,
      }),
    );
    await waitFor(() =>
      expect(api.finalize).toHaveBeenCalledWith({
        path: { session_id: "session-1" },
        body: { production_method: "print", weave: "twill-45", dpi: 300 },
        throwOnError: true,
      }),
    );
    await screen.findByText("결과 job-1");
  });
});
