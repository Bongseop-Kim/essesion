import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  preview: vi.fn(),
  listMotifs: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminMotifsOptions: () => ({
    queryKey: ["authoring-studio-motifs"],
    queryFn: api.listMotifs,
  }),
  previewAuthoringExampleMutation: () => ({ mutationFn: api.preview }),
}));

import { AuthoringExampleForm } from "./example-studio";

const VALID_INTENT = "차분한 세로 스트라이프 넥타이 시범";
const MOTIF_PLAN = {
  colors: ["#F4EFE6", "#213547"], // harness-ignore -- DesignPlanV3 데이터, UI 스타일이 아님
  ground_color_index: 0,
  motifs: [{ source: "input", input_index: 1 }],
  layers: [
    {
      type: "motif",
      motif_index: 0,
      size_ratio: 0.18,
      placement: { type: "point_template", template: "quincunx_inset" },
    },
  ],
};

function previewBodies() {
  return api.preview.mock.calls.map(([variables]) => variables.body);
}

function planInput() {
  return screen.getByLabelText(/Plan \(DesignPlanV3\)/);
}

describe("AuthoringExampleForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    api.listMotifs.mockResolvedValue({
      items: [
        { id: "studio-flower", subject: "flower" },
        { id: "studio-bee", subject: "bee" },
      ],
      total: 2,
    });
  });

  it("붙여 넣은 Plan JSON을 그대로 프리뷰·저장에 보내고, 바뀌면 새 프리뷰까지 저장을 잠근다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={onSubmit}
      />,
    );

    const save = screen.getByRole("button", { name: "시범 저장" });
    expect(
      await screen.findByRole("img", { name: /저작 시범 프리뷰/ }),
    ).toBeTruthy();
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    expect(previewBodies()[0]).toMatchObject({
      motif_ids: [],
      tile_mm: 48,
      plan: { ground_color_index: 0, motifs: [] },
    });

    fireEvent.change(planInput(), {
      target: { value: JSON.stringify(MOTIF_PLAN) },
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await waitFor(() =>
      expect(previewBodies().at(-1)).toMatchObject({ plan: MOTIF_PLAN }),
    );
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );

    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith({
      retrievalText: VALID_INTENT,
      plan: MOTIF_PLAN,
      motifIds: [],
    });
  });

  it("JSON이 깨지면 사유를 보여주고 프리뷰도 저장도 막는다", async () => {
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });
    const calls = api.preview.mock.calls.length;

    fireEvent.change(planInput(), { target: { value: '{"colors": [' } });

    expect(screen.getByText("Plan JSON이 아직 유효하지 않습니다")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "시범 저장" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.preview.mock.calls.length).toBe(calls);
  });

  it("고른 모티프 ID를 Plan과 함께 프리뷰에 보낸다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
        initialPlan={MOTIF_PLAN}
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });

    await user.click(screen.getByRole("button", { name: /모티프 \(0\/2\)/ }));
    await user.click(
      await screen.findByRole("checkbox", { name: /studio-bee/ }),
    );
    await user.click(screen.getByRole("button", { name: "선택 완료" }));

    expect(
      screen.getByRole("button", { name: /모티프 \(1\/2\)/ }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(previewBodies().at(-1)).toMatchObject({
        motif_ids: ["studio-bee"],
        plan: MOTIF_PLAN,
      }),
    );
  });
});
