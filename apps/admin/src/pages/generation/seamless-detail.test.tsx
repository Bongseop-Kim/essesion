import type { SeamlessDetailOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getOptions: vi.fn(),
  createReadUrl: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminSeamlessLogOptions: (options: unknown) => {
    api.getOptions(options);
    return { queryKey: ["seamless-detail"], queryFn: api.get };
  },
  createAdminSeamlessReferenceImageReadUrlMutation: () => ({
    mutationFn: api.createReadUrl,
  }),
}));

import { SeamlessLogDetailPage } from "./seamless-detail";

const log: SeamlessDetailOut = {
  id: "22222222-2222-4222-8222-222222222222",
  request_id: "request-2",
  input_type: "reference_image",
  status: "success",
  candidate_count_requested: 0,
  candidate_count_returned: 0,
  distinct_layouts: 0,
  warning_count: 0,
  generate_ms: 100,
  render_ms: 25,
  engine_version: "1.0",
  registry_version: "v1",
  error_type: null,
  error_summary: null,
  created_at: "2026-07-12T01:00:00Z",
  has_prompt: false,
  has_reference_image: true,
  reference_image_bytes: 2_048,
  reference_image_id: "33333333-3333-4333-8333-333333333333",
  reference_image_available: true,
  seed: 1,
  available_strategies: 0,
  warning_codes: [],
  candidates: [],
};

function renderPage(value: SeamlessDetailOut & Record<string, unknown> = log) {
  api.get.mockResolvedValue(value);
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/generation-logs/seamless/${value.id}`]}>
        <Routes>
          <Route
            path="/generation-logs/seamless/:logId"
            element={<SeamlessLogDetailPage />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("SeamlessLogDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("검증된 관계 ID로만 만료 URL을 발급하고 state의 이미지를 재발급한다", async () => {
    const user = userEvent.setup();
    api.createReadUrl
      .mockResolvedValueOnce({ read_url: "https://storage.example/signed-1" })
      .mockResolvedValueOnce({ read_url: "https://storage.example/signed-2" });
    const { container } = renderPage({
      ...log,
      object_key: "uploads/seamless_generation/private-input.png",
    });

    expect(await screen.findByText("입력 이미지")).toBeTruthy();
    expect(api.getOptions).toHaveBeenCalledWith({
      path: { log_id: log.id },
    });
    expect(
      screen.queryByRole("img", { name: "Seamless 입력 참고 이미지" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("uploads/seamless_generation");

    await user.click(screen.getByRole("button", { name: "입력 이미지 보기" }));

    const image = await screen.findByRole("img", {
      name: "Seamless 입력 참고 이미지",
    });
    expect(image.getAttribute("src")).toBe("https://storage.example/signed-1");
    expect(api.createReadUrl).toHaveBeenCalledWith(
      {
        path: {
          log_id: log.id,
          image_id: log.reference_image_id,
        },
      },
      expect.anything(),
    );
    expect(container.textContent).not.toContain("https://storage.example");

    await user.click(screen.getByRole("button", { name: "URL 재발급" }));
    await waitFor(() => expect(api.createReadUrl).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(image.getAttribute("src")).toBe(
        "https://storage.example/signed-2",
      ),
    );
  });

  it.each([
    {
      name: "관계 ID 없음",
      value: { ...log, reference_image_id: null },
    },
    {
      name: "조회 불가 관계",
      value: { ...log, reference_image_available: false },
    },
  ])("$name 상태에서는 입력 이미지 작업을 노출하지 않는다", async ({
    value,
  }) => {
    renderPage(value);

    expect(
      await screen.findByRole("heading", {
        name: "Seamless 로그 상세",
        level: 1,
      }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "입력 이미지 보기" }),
    ).toBeNull();
    expect(api.createReadUrl).not.toHaveBeenCalled();
  });
});
