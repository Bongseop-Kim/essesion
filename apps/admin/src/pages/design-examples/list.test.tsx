import type { AdminDesignExampleOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminDesignExamplesOptions: () => ({
    queryKey: ["design-examples"],
    queryFn: api.list,
  }),
  listAdminDesignExamplesQueryKey: () => ["design-examples"],
  createAdminDesignExampleMutation: () => ({ mutationFn: api.create }),
  updateAdminDesignExampleMutation: () => ({ mutationFn: api.update }),
  deleteAdminDesignExampleMutation: () => ({ mutationFn: api.remove }),
}));

import { DesignExamplesPage } from "./list";

const RUN_ID = "11111111-1111-4111-8111-111111111111";

const example: AdminDesignExampleOut = {
  id: "example-1",
  run_id: RUN_ID,
  name: "미드나잇 웨이브",
  caption: "네이비 · 대각 스트라이프",
  ordinal: 2,
  published: false,
  preview_svg: "<svg/>",
};

describe("DesignExamplesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([example]);
    api.create.mockResolvedValue(example);
    api.update.mockResolvedValue({ ...example, published: true });
    api.remove.mockResolvedValue(undefined);
  });

  it("run ID로 예시를 등록한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<DesignExamplesPage />);
    await screen.findByRole("switch", { name: "미드나잇 웨이브 게시" });

    // 필수 표시(*)가 라벨 텍스트에 붙는다.
    await user.type(screen.getByLabelText(/run ID/), RUN_ID);
    await user.type(screen.getByLabelText(/갤러리 이름/), "미드나잇 웨이브");
    await user.type(
      screen.getByLabelText("카드 설명"),
      "네이비 · 대각 스트라이프",
    );
    await user.type(screen.getByLabelText("노출 순서"), "3");
    await user.click(screen.getByRole("button", { name: "비게시로 등록" }));

    await waitFor(() =>
      expect(api.create.mock.calls[0]?.[0]).toEqual({
        body: {
          run_id: RUN_ID,
          name: "미드나잇 웨이브",
          caption: "네이비 · 대각 스트라이프",
          ordinal: 3,
        },
      }),
    );
  });

  it("게시 스위치는 즉시, 순서는 포커스를 잃을 때만 저장한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<DesignExamplesPage />);
    await screen.findByRole("switch", { name: "미드나잇 웨이브 게시" });

    await user.click(
      screen.getByRole("switch", { name: "미드나잇 웨이브 게시" }),
    );
    await waitFor(() =>
      expect(api.update.mock.calls[0]?.[0]).toEqual({
        path: { example_id: "example-1" },
        body: { published: true },
      }),
    );

    const ordinal = screen.getByLabelText("미드나잇 웨이브 노출 순서");
    await user.clear(ordinal);
    await user.type(ordinal, "5");
    expect(api.update).toHaveBeenCalledTimes(1);

    await user.tab();
    await waitFor(() =>
      expect(api.update.mock.calls.at(-1)?.[0]).toEqual({
        path: { example_id: "example-1" },
        body: { ordinal: 5 },
      }),
    );
  });

  it("삭제는 확인 다이얼로그를 지나서만 호출된다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<DesignExamplesPage />);
    await screen.findByRole("switch", { name: "미드나잇 웨이브 게시" });

    await user.click(screen.getByRole("button", { name: "삭제" }));
    expect(api.remove).not.toHaveBeenCalled();

    // 행 버튼과 다이얼로그 확인 버튼이 같은 이름이라 마지막(다이얼로그)을 누른다.
    const confirms = await screen.findAllByRole("button", { name: "삭제" });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() =>
      expect(api.remove.mock.calls[0]?.[0]).toEqual({
        path: { example_id: "example-1" },
      }),
    );
  });
});
