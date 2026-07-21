import type { SeamlessDetailOut } from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

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
  failure_code: null,
  failure_stage: null,
  created_at: "2026-07-12T01:00:00Z",
  has_prompt: false,
  prompt: null,
  intents: [],
  has_reference_image: true,
  reference_image_bytes: 2_048,
  reference_image_id: "33333333-3333-4333-8333-333333333333",
  reference_image_available: true,
  seed: 1,
  available_strategies: 0,
  warning_codes: [],
  diagnostics: {
    mode: "prompt",
    model: "gemini-2.5-flash-lite",
    reference_count: 1,
    fixed_palette: false,
    pattern_controls: false,
    authoring_attempts: 1,
    plan_count: 3,
    validated_count: 3,
    resolved_count: 3,
    candidate_count: 0,
    failure_code: null,
    failure_stage: null,
  },
  candidates: [],
};

function renderPage(value: SeamlessDetailOut & Record<string, unknown> = log) {
  api.get.mockResolvedValue(value);
  return renderAdminPage(
    <Routes>
      <Route
        path="/generation-logs/seamless/:logId"
        element={<SeamlessLogDetailPage />}
      />
    </Routes>,
    { entry: `/generation-logs/seamless/${value.id}` },
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

  it("저장된 프롬프트 원문을 줄바꿈 그대로 표시한다", async () => {
    const prompt = "청록색 꽃무늬를 작게 배치해 줘.\n꽃 사이 간격은 넓게.";
    renderPage({
      ...log,
      input_type: "prompt",
      has_prompt: true,
      prompt,
    });

    expect(await screen.findByText("프롬프트 원문")).toBeTruthy();
    expect(
      screen.getByText(prompt, { normalizer: (value) => value }),
    ).toBeTruthy();
  });

  it("프롬프트에서 확정된 intent를 디자인별 JSON으로 표시한다", async () => {
    const user = userEvent.setup();
    const intent = {
      intent_version: 1,
      canvas: { tile_mm: 48, dpi: 300 },
      seed: 7,
      production: { method: "print", max_colors: 4 },
      palette: { slots: [{ id: "ground", hex: "#112233" }] },
      colorways: [{ id: "default", mapping: { ground: "#112233" } }],
      layers: [
        {
          id: "flower",
          type: "motif",
          params: { motif_id: "motif-safe", size_mm: 12, color: "ground" },
          placement: {
            type: "lattice",
            lattice: { cell_w_mm: 24, cell_h_mm: 24 },
          },
          z_order: 1,
        },
      ],
    };
    renderPage({
      ...log,
      input_type: "prompt",
      has_prompt: true,
      prompt: "청록색 꽃무늬를 작게 배치해 줘.",
      intents: [intent],
    });

    expect(await screen.findByText("생성 Intent")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Intent 1 JSON" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "Intent 1 JSON" });
    expect(within(region).getByText(/"intent_version": 1/)).toBeTruthy();
    expect(within(region).getByText(/"motif_id": "motif-safe"/)).toBeTruthy();
    expect(within(region).getByText(/"type": "lattice"/)).toBeTruthy();
  });

  it("후보 결과를 store 디자인 페이지와 같은 데스크톱 4열로 표시한다", async () => {
    renderPage({
      ...log,
      candidate_count_returned: 1,
      candidates: [
        {
          id: "candidate-1",
          design_index: 0,
          layout_id: "layout-1",
          source_fidelity: "exact",
          colorway_id: "default",
          seed: 7,
          svg: null,
          svg_status: "unavailable",
        },
      ],
    });

    const heading = await screen.findByRole("heading", { name: "후보 1" });
    const grid = heading.closest("section")?.parentElement;
    expect(grid?.style.gridTemplateColumns).toBe("repeat(4, minmax(0, 1fr))");
  });

  it("상태·입력·경고를 한국어 의미와 해결 방법으로 표시하고 원 코드는 접어 둔다", async () => {
    const user = userEvent.setup();
    renderPage({
      ...log,
      status: "partial",
      input_type: "prompt",
      has_prompt: true,
      prompt: "청록색 꽃무늬를 작게 배치해 줘.",
      warning_count: 3,
      warning_codes: [
        "preview_unavailable",
        "partial_candidates",
        "generation_warning",
      ],
    });

    expect(await screen.findAllByText("부분 성공")).toHaveLength(2);
    expect(screen.getByText("텍스트 프롬프트")).toBeTruthy();
    expect(screen.getByText("미리보기를 저장하지 못했습니다")).toBeTruthy();
    expect(screen.getByText("후보가 일부만 생성되었습니다")).toBeTruthy();
    expect(screen.getByText("생성 결과를 확인해 주세요")).toBeTruthy();
    expect(screen.getByText("생성 진단")).toBeTruthy();
    expect(screen.getByText("gemini-2.5-flash-lite")).toBeTruthy();
    expect(screen.getByText("3 / 3")).toBeTruthy();
    expect(
      screen.getByText(
        "후보 SVG를 확인하고, 이미지 미리보기가 필요하면 생성을 다시 실행해 주세요.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "반환된 후보를 검토하고, 선택지가 부족하면 같은 조건으로 다시 생성해 주세요.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    expect(screen.queryByText("preview_unavailable")).toBeNull();
    expect(screen.queryByText("partial_candidates")).toBeNull();

    await user.click(screen.getByRole("button", { name: "기술 정보" }));

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(within(region).getByText(/"status": "partial"/)).toBeTruthy();
    expect(within(region).getByText(/"input_type": "prompt"/)).toBeTruthy();
    expect(within(region).getByText(/"preview_unavailable"/)).toBeTruthy();
    expect(within(region).getByText(/"partial_candidates"/)).toBeTruthy();
  });

  it("로그와 엔진 식별자를 기본으로 접어 둔다", async () => {
    const user = userEvent.setup();
    renderPage();

    const trigger = await screen.findByRole("button", { name: "기술 정보" });
    const backLink = screen.getByRole("link", {
      name: "Seamless 로그 목록으로 돌아가기",
    });
    expect(
      backLink.compareDocumentPosition(trigger) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(within(region).getByText(/"request_id": "request-2"/)).toBeTruthy();
    expect(within(region).getByText(/"engine_version": "1.0"/)).toBeTruthy();
  });
});
