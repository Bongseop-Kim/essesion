import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  listOptions: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAuthoringCandidatesOptions: (options: unknown) => {
    api.listOptions(options);
    return {
      queryKey: ["authoring-candidates", JSON.stringify(options)],
      queryFn: api.list,
    };
  },
}));

import { FewShotCandidatesPage } from "./candidates-list";

describe("FewShotCandidatesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue({ items: [], total: 0, limit: 20, offset: 0 });
  });

  it("검토 상태 전체를 기본으로 조회한다", async () => {
    renderAdminPage(<FewShotCandidatesPage />, {
      entry: "/few-shot-candidates",
    });

    await screen.findByText("조건에 맞는 few-shot 후보가 없습니다");
    expect(api.listOptions).toHaveBeenCalledWith({
      query: {
        status: "all",
        q: undefined,
        limit: 20,
        offset: 0,
      },
    });
  });
});
