import type { AuthoringExampleDetailOut } from "@essesion/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  preview: vi.fn(),
  listMotifs: vi.fn(),
  remove: vi.fn(),
  setActivation: vi.fn(),
}));
const auth = vi.hoisted(() => ({ role: "admin" }));

vi.mock("@essesion/api-client/query", () => ({
  getAuthoringExampleOptions: () => ({
    queryKey: ["authoring-example"],
    queryFn: api.get,
  }),
  getAuthoringExampleQueryKey: () => ["authoring-example"],
  listAuthoringExamplesQueryKey: () => ["authoring-examples"],
  listAdminMotifsOptions: () => ({
    queryKey: ["authoring-studio-motifs"],
    queryFn: api.listMotifs,
  }),
  previewAuthoringExampleMutation: () => ({ mutationFn: api.preview }),
  updateAuthoringExampleMutation: () => ({ mutationFn: api.update }),
  deleteAuthoringExampleMutation: () => ({ mutationFn: api.remove }),
  setAuthoringExampleActivationMutation: () => ({
    mutationFn: api.setActivation,
  }),
}));

vi.mock("../../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: { userId: "admin-1", displayName: "운영자", role: auth.role },
    },
  }),
}));

import { AuthoringExampleDetailPage } from "./example-detail";

const PLAN = {
  colors: ["#F4EFE6", "#213547"], // harness-ignore -- DesignPlanV3 데이터, UI 스타일이 아님
  ground_color_index: 0,
  motifs: [],
  layers: [],
};
const INPUT_MOTIF_PLAN = {
  ...PLAN,
  motifs: [{ source: "input", input_index: 1 }],
};

const example: AuthoringExampleDetailOut = {
  active: false,
  active_reason: null,
  active_updated_at: null,
  active_updated_by: null,
  approved_at: "2026-07-20T01:00:00Z",
  approved_by: "admin-1",
  contract_version: 3,
  created_at: "2026-07-20T01:00:00Z",
  embedding_model: "text-embedding-005",
  example_id: "authored_f25b0cd6",
  family: "solid",
  id: "f25b0cd6-4681-4ea5-9845-3430fdb95009",
  motif_count: 0,
  motif_ids: [],
  plan: PLAN,
  retrieval_text: "차분한 단색 배경 넥타이 시범",
  /* bootstrap도 이제 편집·삭제 대상 — 완화된 정책을 그대로 검증한다 */
  source: "bootstrap",
  source_digest: "digest-1",
  structural_fingerprint: "fingerprint-1",
  tags: ["background", "solid"],
  updated_at: "2026-07-20T01:00:00Z",
};

function renderPage() {
  renderAdminPage(
    <Routes>
      <Route
        path="/few-shot-examples/:exampleId"
        element={<AuthoringExampleDetailPage />}
      />
    </Routes>,
    { entry: `/few-shot-examples/${example.id}` },
  );
}

describe("AuthoringExampleDetailPage", () => {
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
    api.get.mockResolvedValue(example);
    api.update.mockResolvedValue({
      ...example,
      updated_at: "2026-07-21T01:00:00Z",
    });
    api.preview.mockResolvedValue({
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"/>',
      warnings: [],
    });
    api.listMotifs.mockResolvedValue({ items: [], total: 0 });
  });

  it("저장된 Plan JSON을 읽기 전용으로 보여주고 같은 Plan으로 프리뷰를 그린다", async () => {
    renderPage();

    const json = (await screen.findByLabelText(
      /Plan \(DesignPlanV3\)/,
    )) as HTMLTextAreaElement;
    expect(json.readOnly).toBe(true);
    expect(JSON.parse(json.value)).toEqual(PLAN);
    expect(
      await screen.findByRole("img", { name: /저작 시범 프리뷰/ }),
    ).toBeTruthy();
    expect(api.preview.mock.calls.at(0)?.[0].body).toMatchObject({
      plan: PLAN,
      motif_ids: [],
    });
  });

  it("상세에서는 프리뷰 모티프를 바꿀 수 없고 수정 화면에서만 고른다", async () => {
    const user = userEvent.setup();
    api.get.mockResolvedValue({
      ...example,
      motif_count: 1,
      plan: INPUT_MOTIF_PLAN,
    });
    renderPage();

    await screen.findByRole("img", { name: /저작 시범 프리뷰/ });
    expect(screen.queryByRole("button", { name: "모티프 선택" })).toBeNull();
    expect(api.preview.mock.calls.at(0)?.[0].body).toMatchObject({
      plan: INPUT_MOTIF_PLAN,
      motif_ids: [],
    });

    await user.click(screen.getByRole("button", { name: "수정" }));
    expect(
      screen.getByRole("button", { name: /모티프 \(0\/2\)/ }),
    ).toBeTruthy();
  });

  it("수정 버튼으로 편집에 들어가 Plan을 저장한다", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "수정" }));
    const nextPlan = { ...PLAN, ground_color_index: 1 };
    await user.clear(screen.getByLabelText(/Plan \(DesignPlanV3\)/));
    await user.paste(JSON.stringify(nextPlan));

    const save = screen.getByRole("button", { name: "시범 변경 저장" });
    await waitFor(() =>
      expect((save as HTMLButtonElement).disabled).toBe(false),
    );
    await user.click(save);

    await waitFor(() =>
      expect(api.update).toHaveBeenCalledWith(
        {
          path: { example_id: example.id },
          body: expect.objectContaining({
            expected_updated_at: example.updated_at,
            retrieval_text: example.retrieval_text,
            plan: nextPlan,
            motif_ids: [],
          }),
        },
        expect.anything(),
      ),
    );
    /* 저장 성공 후에는 읽기 전용 뷰로 돌아온다 */
    expect(await screen.findByRole("button", { name: "수정" })).toBeTruthy();
  });

  it("manager 역할에는 수정 버튼을 노출하지 않는다", async () => {
    auth.role = "manager";
    renderPage();

    await screen.findByLabelText(/Plan \(DesignPlanV3\)/);
    expect(screen.queryByRole("button", { name: "수정" })).toBeNull();
  });

  it("사유 입력 없이 확인 다이얼로그만으로 활성화한다", async () => {
    const user = userEvent.setup();
    api.setActivation.mockResolvedValue({ ...example, active: true });
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "시범 활성화" }),
    );
    await user.click(await screen.findByRole("button", { name: "활성화" }));

    await waitFor(() =>
      expect(api.setActivation).toHaveBeenCalledWith(
        {
          path: { example_id: example.id },
          body: {
            operation_id: expect.any(String),
            active: true,
            expected_updated_at: example.updated_at,
          },
        },
        expect.anything(),
      ),
    );
  });

  it("비활성 상태에서 삭제 버튼으로 사유 없이 영구 삭제한다", async () => {
    const user = userEvent.setup();
    api.remove.mockResolvedValue(undefined);
    renderPage();

    await user.click(
      await screen.findByRole("button", { name: "시범 영구 삭제" }),
    );
    await user.click(await screen.findByRole("button", { name: "영구 삭제" }));

    await waitFor(() =>
      expect(api.remove).toHaveBeenCalledWith(
        {
          path: { example_id: example.id },
          body: { operation_id: expect.any(String) },
        },
        expect.anything(),
      ),
    );
  });
});
