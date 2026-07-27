import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  create: vi.fn(),
  preview: vi.fn(),
  listMotifs: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@essesion/api-client/query", () => ({
  createAuthoringExampleMutation: () => ({ mutationFn: api.create }),
  listAdminMotifsOptions: () => ({
    queryKey: ["authoring-studio-motifs"],
    queryFn: api.listMotifs,
  }),
  listAuthoringExamplesQueryKey: () => ["authoring-examples"],
  previewAuthoringExampleMutation: () => ({ mutationFn: api.preview }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: auth.role },
    },
  }),
}));

import { FewShotExampleNewPage } from "./example-new";

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route
        path="/few-shot-examples/new"
        element={<FewShotExampleNewPage />}
      />
      <Route path="/few-shot-examples/:exampleId" element={<p>시범 상세</p>} />
    </Routes>,
    { entry: "/few-shot-examples/new" },
  );
}

describe("FewShotExampleNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.role = "admin";
    Object.defineProperties(URL, {
      createObjectURL: {
        configurable: true,
        value: vi.fn(() => "blob:authoring-preview"),
      },
      revokeObjectURL: { configurable: true, value: vi.fn() },
    });
    api.preview.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"/>',
      warnings: [],
    });
    api.listMotifs.mockResolvedValue({ items: [], total: 0 });
    api.create.mockResolvedValue({ id: "example-1" });
  });

  it("프리뷰한 intent와 Plan을 비활성 시범으로 저장하고 상세로 이동한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(
      screen.getByLabelText(/예시 사용자 요청문/),
      "차분한 격자무늬 넥타이 시범",
    );
    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });
    const save = screen.getByRole("button", { name: "비활성 시범 저장" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(save);

    await waitFor(() =>
      expect(api.create).toHaveBeenCalledWith(
        {
          body: {
            retrieval_text: "차분한 격자무늬 넥타이 시범",
            plan: expect.objectContaining({ ground_color_index: 0 }),
            motif_ids: [],
          },
        },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("시범 상세")).toBeTruthy();
  });

  it("manager 역할에는 작성 폼을 노출하지 않는다", () => {
    auth.role = "manager";
    renderPage();

    expect(screen.getByText("시범 작성 권한이 없습니다")).toBeTruthy();
    expect(screen.queryByLabelText(/예시 사용자 요청문/)).toBeNull();
  });
});
