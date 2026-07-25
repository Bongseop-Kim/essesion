import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  create: vi.fn(),
  listMotifs: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  createAuthoringExampleMutation: () => ({ mutationFn: api.create }),
  listAdminMotifsOptions: () => ({
    queryKey: ["authoring-studio-motifs"],
    queryFn: api.listMotifs,
  }),
  listAuthoringExamplesQueryKey: () => ["authoring-examples"],
  previewAuthoringExampleMutation: () => ({ mutationFn: api.preview }),
}));

import { AuthoringExampleForm } from "./example-studio";

const createObjectURL = vi.fn(() => "blob:authoring-preview");
const revokeObjectURL = vi.fn();

describe("AuthoringExampleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
    api.preview.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"/>',
      warnings: [],
    });
  });

  it("현재 Plan 프리뷰가 성공해야 정규화한 intent와 Plan을 저장한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderAdminPage(
      <AuthoringExampleForm
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={onSubmit}
      />,
    );

    const save = screen.getByRole("button", { name: "시범 저장" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByLabelText(/검색 intent/),
      "  차분한 격자무늬 넥타이 시범  ",
    );
    await user.click(screen.getByRole("button", { name: "타일 프리뷰" }));

    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith(
        {
          body: {
            plan: expect.objectContaining({
              ground_color_index: 0,
              motifs: [{ source: "input", input_index: 1 }],
            }),
            motif_ids: [],
            tile_mm: 48,
          },
        },
        expect.anything(),
      ),
    );
    expect(
      await screen.findByRole("img", { name: "저작 시범 타일 프리뷰" }),
    ).toBeTruthy();
    expect((save as HTMLButtonElement).disabled).toBe(false);

    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith({
      retrievalText: "차분한 격자무늬 넥타이 시범",
      plan: expect.objectContaining({
        ground_color_index: 0,
        motifs: [{ source: "input", input_index: 1 }],
      }),
      motifIds: [],
    });
  });

  it("프리뷰 뒤 Plan이 바뀌면 저장을 다시 잠근다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText="차분한 격자무늬 넥타이 시범"
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "타일 프리뷰" }));
    await screen.findByRole("img", { name: "저작 시범 타일 프리뷰" });
    const save = screen.getByRole("button", { name: "시범 저장" });
    expect((save as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText(/DesignPlanV3 JSON/), {
      target: { value: "{}" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.queryByRole("img", { name: "저작 시범 타일 프리뷰" }),
    ).toBeNull();
  });
});
