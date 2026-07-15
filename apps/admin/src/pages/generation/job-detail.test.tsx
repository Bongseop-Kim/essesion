import type { GenerationJobDetailOut } from "@essesion/api-client";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  getAdminGenerationJobOptions: () => ({
    queryKey: ["generation-job"],
    queryFn: api.get,
  }),
}));

import { GenerationJobDetailPage } from "./job-detail";

const job: GenerationJobDetailOut = {
  id: "job-1",
  status: "succeeded",
  kind: "finalize",
  attempts: 1,
  owner_reference: "owner-1",
  request_id: "request-1",
  session_id: "session-1",
  parameter_summary: {
    dpi: 300,
    has_intent: true,
    production_method: "yarn_dyed",
    weave: "twill-45",
    texture_strength: 0.7,
    relief_strength: 0.2,
  },
  result_available: false,
  result_url: null,
  error_summary: null,
  created_at: "2026-07-12T01:00:00Z",
  updated_at: "2026-07-12T01:00:01Z",
};

describe("GenerationJobDetailPage", () => {
  it("작업 입력은 사람이 읽는 요약으로 먼저 표시하고 원문은 마지막에 접어 둔다", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue(job);
    renderAdminPage(
      <Routes>
        <Route
          path="/generation-logs/jobs/:jobId"
          element={<GenerationJobDetailPage />}
        />
      </Routes>,
      { entry: "/generation-logs/jobs/job-1" },
    );

    const trigger = await screen.findByRole("button", { name: "기술 정보" });
    const summaryHeading = screen.getByRole("heading", {
      name: "입력 요약",
    });
    const resultHeading = screen.getByRole("heading", { name: "결과" });

    expect(screen.getByText("포함")).toBeTruthy();
    expect(screen.getByText("300 DPI")).toBeTruthy();
    expect(screen.getByText("선염")).toBeTruthy();
    expect(screen.getByText("사선 트윌")).toBeTruthy();
    expect(screen.getByText("0.7")).toBeTruthy();
    expect(screen.getByText("0.2")).toBeTruthy();
    expect(
      summaryHeading.compareDocumentPosition(resultHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(
      resultHeading.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(within(region).getByText(/"job_id": "job-1"/)).toBeTruthy();
    expect(within(region).getByText(/"dpi": 300/)).toBeTruthy();
    expect(
      within(region).getByText(/"production_method": "yarn_dyed"/),
    ).toBeTruthy();
  });
});
