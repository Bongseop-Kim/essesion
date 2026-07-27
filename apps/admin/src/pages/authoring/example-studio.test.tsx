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

function previewBodies() {
  return api.preview.mock.calls.map(([variables]) => variables.body);
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
        { id: "studio-flower", subject: "flower", color_slot_count: 1 },
        { id: "studio-bee", subject: "bee", color_slot_count: 1 },
      ],
      total: 2,
    });
  });

  it("버튼 없이 프리뷰를 그리고, Plan이 바뀌면 새 프리뷰가 올 때까지 저장을 잠근다", async () => {
    const onSubmit = vi.fn();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByRole("button", { name: "타일 프리뷰" })).toBeNull();
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

    fireEvent.change(screen.getByLabelText(/반복 주기 비율/), {
      target: { value: "0.25" },
    });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    await waitFor(() =>
      expect(previewBodies().at(-1)).toMatchObject({
        plan: { layers: [{ type: "stripe", period_ratio: 0.25 }] },
      }),
    );
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("모티프를 고르면 슬롯과 모티프 레이어를 붙여 바로 프리뷰에 반영한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
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
        plan: {
          motifs: [{ source: "input", input_index: 1 }],
          layers: [{ type: "stripe" }, { type: "motif", motif_index: 0 }],
        },
      }),
    );
  });

  it("팔레트 HEX가 잘못되면 프리뷰를 쏘지 않고 저장도 잠근다", async () => {
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

    fireEvent.change(screen.getByLabelText(/1번 HEX/), {
      target: { value: "#12" },
    });

    expect(screen.getByText("입력을 먼저 정리해 주세요")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "시범 저장" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(api.preview.mock.calls.length).toBe(calls);
  });

  it("모티프 레이어를 지우면 프리뷰를 막고 사유를 알려준다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <AuthoringExampleForm
        initialRetrievalText={VALID_INTENT}
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={vi.fn()}
      />,
    );
    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });

    await user.click(screen.getByRole("button", { name: /모티프 \(0\/2\)/ }));
    await user.click(
      await screen.findByRole("checkbox", { name: /studio-flower/ }),
    );
    await user.click(screen.getByRole("button", { name: "선택 완료" }));
    await user.click(screen.getByRole("button", { name: "2번 레이어 삭제" }));

    expect(
      screen.getByText("1번 모티프를 쓰는 레이어가 없습니다"),
    ).toBeTruthy();
    expect(screen.getByText("입력을 먼저 정리해 주세요")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "시범 저장" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("프리뷰가 현재 입력과 일치할 때 정규화한 intent와 Plan을 저장한다", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    renderAdminPage(
      <AuthoringExampleForm
        submitLabel="시범 저장"
        submitting={false}
        onSubmit={onSubmit}
      />,
    );

    await user.type(
      screen.getByLabelText(/예시 사용자 요청문/),
      `  ${VALID_INTENT}  `,
    );
    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });
    const save = screen.getByRole("button", { name: "시범 저장" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );

    await user.click(save);
    expect(onSubmit).toHaveBeenCalledWith({
      retrievalText: VALID_INTENT,
      plan: expect.objectContaining({ ground_color_index: 0, motifs: [] }),
      motifIds: [],
    });
  });
});
