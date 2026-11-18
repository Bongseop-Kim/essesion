// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("@essesion/api-client/query", () => ({
  sendCustomEstimateEmailMutation: () => ({ mutationFn: api.send }),
}));

import { EstimateEmailModal } from "./estimate-email-modal";

const PAYLOAD = { options: { fabric_provided: true }, quantity: 10 };

function renderModal(onOpenChange = vi.fn()) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <EstimateEmailModal
        open
        onOpenChange={onOpenChange}
        payload={PAYLOAD}
        defaultEmail="buyer@example.com"
        defaultCompanyName=""
      />
    </QueryClientProvider>,
  );
  return onOpenChange;
}

describe("EstimateEmailModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.send.mockResolvedValue(undefined);
    // jsdom에 없는 것들 — 프리미티브의 반응형 값과 Modal의 dialog가 쓴다.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("계정 메일을 채워 두고, 보내면 사양·주소·업체명을 함께 보낸다", async () => {
    const onOpenChange = renderModal();
    fireEvent.change(screen.getByLabelText("업체명 (선택)"), {
      target: { value: " (주)샘플상사 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(api.send.mock.calls[0]?.[0]).toEqual({
      body: {
        ...PAYLOAD,
        email: "buyer@example.com",
        company_name: "(주)샘플상사",
      },
    });
  });

  it("주소가 여러 개이거나 업체명에 금지 문자가 있으면 보내지 않는다", async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText("받을 메일 주소"), {
      target: { value: "a@b.co, c@d.ee" },
    });
    fireEvent.change(screen.getByLabelText("업체명 (선택)"), {
      target: { value: "=HYPERLINK(1)" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(await screen.findByText("메일 주소를 확인해 주세요.")).toBeTruthy();
    expect(api.send).not.toHaveBeenCalled();
  });

  it("발송에 실패하면 창을 닫지 않고 사유를 창 안에 남긴다", async () => {
    api.send.mockRejectedValue(
      new Error("견적서 메일 요청이 너무 많습니다. 잠시 후 다시 시도해주세요."),
    );
    const onOpenChange = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(
      await screen.findByText(
        "견적서 메일 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      ),
    ).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
