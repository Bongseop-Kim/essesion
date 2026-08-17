import type { SeamlessDetailOut } from "@essesion/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  getOptions: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  getAdminSeamlessLogOptions: (options: unknown) => {
    api.getOptions(options);
    return { queryKey: ["seamless-detail"], queryFn: api.get };
  },
}));

import { SeamlessLogDetailPage } from "./seamless-detail";

const log: SeamlessDetailOut = {
  id: "22222222-2222-4222-8222-222222222222",
  request_id: "request-2",
  input_type: "prompt",
  status: "success",
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
  intent: null,
  seed: 1,
  warning_groups: [],
  diagnostics: {
    mode: "prompt",
    model: "gpt-5.6-luna",
    prompt_revision: null,
    patch_axes: [],
    authoring_attempts: 1,
    catalog_candidate_count: null,
    resolved_count: 3,
    authoring_ms: null,
    compose_ms: null,
    render_ms: null,
    failure_code: null,
    failure_stage: null,
    failure_provider: null,
    failure_operation: null,
    failure_reason: null,
    failure_status_code: null,
    motif_resolutions: [],
  },
  outcome: {
    session_id: null,
    user_id: null,
    user_name: null,
    reactivated: false,
    regenerated: false,
    finalized: false,
  },
  token_accounting: {
    matched: false,
    debited: 0,
    refunded: 0,
    net: 0,
  },
  design: null,
};

function renderPage(value: SeamlessDetailOut & Record<string, unknown> = log) {
  api.get.mockResolvedValue(value);
  return renderAdminPage(
    <Routes>
      <Route path="/seamless-logs/:logId" element={<SeamlessLogDetailPage />} />
    </Routes>,
    { entry: `/seamless-logs/${value.id}` },
  );
}

describe("SeamlessLogDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("프롬프트에서 확정된 intent를 JSON으로 표시한다", async () => {
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
      intent,
    });

    expect(await screen.findByText("생성 Intent")).toBeTruthy();
    const trigger = screen.getByRole("button", { name: "Intent JSON" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "Intent JSON" });
    expect(within(region).getByText(/"intent_version": 1/)).toBeTruthy();
    expect(within(region).getByText(/"motif_id": "motif-safe"/)).toBeTruthy();
    expect(within(region).getByText(/"type": "lattice"/)).toBeTruthy();
  });

  it("생성 결과를 디자인 1개로 표시한다", async () => {
    renderPage({
      ...log,
      design: {
        id: "design-1",
        layout_id: "layout-1",
        source_fidelity: "exact",
        colorway_id: "default",
        seed: 7,
        svg: null,
        svg_status: "unavailable",
      },
    });

    expect(await screen.findByText("design-1")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "디자인" })).toBeTruthy();
    expect(screen.queryByText(/후보 1/)).toBeNull();
    expect(
      screen
        .getByText("생성 결과")
        .compareDocumentPosition(screen.getByText("로그 정보")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("디자인이 기록되지 않은 생성은 빈 상태로 표시한다", async () => {
    renderPage();

    expect(await screen.findByText("표시할 디자인이 없습니다")).toBeTruthy();
  });

  it("상세 결과를 수동으로 새로고침한다", async () => {
    const user = userEvent.setup();
    renderPage();

    const refresh = await screen.findByRole("button", { name: "새로고침" });
    expect(api.get).toHaveBeenCalledTimes(1);

    await user.click(refresh);

    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
  });

  it("경고를 실제 원인과 건수로 묶어 표시한다", async () => {
    const user = userEvent.setup();
    renderPage({
      ...log,
      status: "partial",
      input_type: "prompt",
      has_prompt: true,
      prompt: "청록색 꽃무늬를 작게 배치해 줘.",
      warning_count: 8,
      warning_groups: [
        {
          code: "motif_layer_dropped",
          count: 2,
          items: ["triangle", "line"],
        },
        {
          code: "cmyk_gamut",
          count: 6,
          items: ["#0000FF", "#00FF00", "#FF0000"],
        },
      ],
    });

    expect(await screen.findAllByText("부분 성공")).toHaveLength(2);
    expect(screen.getByText("텍스트 프롬프트")).toBeTruthy();
    expect(screen.getByText("모티프 레이어 2개를 제외했습니다")).toBeTruthy();
    expect(screen.getByText("CMYK 색역 확인이 필요한 색상 6개")).toBeTruthy();
    expect(screen.getByText("생성 진단")).toBeTruthy();
    expect(screen.getByText("gpt-5.6-luna")).toBeTruthy();
    expect(screen.queryByText("GPT Image 호출")).toBeNull();
    expect(
      screen.getByText(/생성 실패가 아니라 인쇄 전 색상 확인/),
    ).toBeTruthy();
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    expect(screen.queryByText("motif_layer_dropped")).toBeNull();
    expect(screen.queryByText("cmyk_gamut")).toBeNull();

    await user.click(screen.getByRole("button", { name: "기술 정보" }));

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(within(region).getByText(/"status": "partial"/)).toBeTruthy();
    expect(within(region).getByText(/"input_type": "prompt"/)).toBeTruthy();
    expect(within(region).getByText(/"motif_layer_dropped"/)).toBeTruthy();
    expect(within(region).getByText(/"cmyk_gamut"/)).toBeTruthy();
  });

  it("간격과 스트라이프 주기 자동 보정을 운영자가 이해할 수 있게 표시한다", async () => {
    renderPage({
      ...log,
      warning_count: 2,
      warning_groups: [
        { code: "spacing_snap", count: 1, items: [] },
        { code: "stripe_period_snap", count: 1, items: [] },
      ],
    });

    expect(
      await screen.findByText("모티프 간격 1건을 타일 경계에 맞췄습니다"),
    ).toBeTruthy();
    expect(
      screen.getByText("스트라이프 주기 1건을 타일 경계에 맞췄습니다"),
    ).toBeTruthy();
    expect(screen.getAllByText(/생성 실패가 아닙니다/)).toHaveLength(2);
    expect(screen.queryByText(/분류되지 않은 생성 경고/)).toBeNull();
  });

  it("외부 연동 단계·모티프 해석·사용자 결과를 함께 표시한다", async () => {
    renderPage({
      ...log,
      diagnostics: {
        ...log.diagnostics,
        mode: "patch",
        patch_axes: ["background", "motif_size_mm"],
        patch: {
          placement: { arrangement: "staggered", count_per_axis: 4 },
          note: "간격을 넓히고 대각선으로 배치했습니다",
        },
        prompt_revision: "design-plan-v1",
        authoring_ms: 121,
        compose_ms: 18,
        render_ms: 9,
        failure_provider: "openai_embedding",
        failure_operation: "embed",
        failure_reason: "rate_limited",
        failure_status_code: 429,
        motif_resolutions: [
          {
            layer_id: "motif_1",
            subject: "triangle",
            scope: "partial",
            outcome: "dropped",
            motif_id: null,
            similarity: null,
            match_type: null,
            provider: "openai_embedding",
            operation: "embed",
            reason_code: "rate_limited",
            status_code: 429,
          },
        ],
      },
      outcome: {
        session_id: "44444444-4444-4444-8444-444444444444",
        user_id: "55555555-5555-4555-8555-555555555555",
        user_name: "김고객",
        reactivated: true,
        regenerated: true,
        finalized: true,
      },
      design: {
        id: "design-1",
        layout_id: "layout-1",
        source_fidelity: "exact",
        colorway_id: "default",
        seed: 7,
        svg: null,
        svg_status: "unavailable",
      },
    });

    expect(await screen.findByText("design-plan-v1")).toBeTruthy();
    expect(screen.getByText("저작 121ms · 합성 18ms · 렌더 9ms")).toBeTruthy();
    expect(screen.getByText("구성 수정")).toBeTruthy();
    expect(screen.getByText("바탕색 · 무늬 크기")).toBeTruthy();
    expect(screen.getByText("구성 patch 원본")).toBeTruthy();
    expect(screen.getByText("OpenAI 임베딩 · embed")).toBeTruthy();
    expect(screen.getByText("요청 한도 초과 (429)")).toBeTruthy();
    expect(
      screen.getByText(/OpenAI 임베딩: 요청 한도 초과 \(429\)/),
    ).toBeTruthy();

    const outcome = screen
      .getByRole("heading", { name: "사용자 결과" })
      .closest("section");
    expect(outcome).not.toBeNull();
    expect(
      within(outcome as HTMLElement).getByText("이력에서 다시 활성화"),
    ).toBeTruthy();
    expect(within(outcome as HTMLElement).getAllByText("있음")).toHaveLength(2);
    expect(within(outcome as HTMLElement).getByText("완료")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "김고객" }).getAttribute("href"),
    ).toBe("/customers/55555555-5555-4555-8555-555555555555");
  });

  it("토큰 차감·환불·순변동과 미연결 상태를 구분한다", async () => {
    const unmatched = renderPage();
    expect(await screen.findByText("연결된 토큰 기록 없음")).toBeTruthy();
    unmatched.unmount();

    renderPage({
      ...log,
      token_accounting: {
        matched: true,
        debited: 5,
        refunded: 2,
        net: -3,
      },
    });

    const accounting = (
      await screen.findByRole("heading", { name: "토큰 정산" })
    ).closest("section");
    expect(accounting).not.toBeNull();
    expect(within(accounting as HTMLElement).getByText("-5 토큰")).toBeTruthy();
    expect(within(accounting as HTMLElement).getByText("+2 토큰")).toBeTruthy();
    expect(within(accounting as HTMLElement).getByText("-3 토큰")).toBeTruthy();
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
