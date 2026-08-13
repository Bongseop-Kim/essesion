// @vitest-environment jsdom

import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  loadTossPayments: vi.fn(),
}));

vi.mock("@tosspayments/tosspayments-sdk", () => ({
  loadTossPayments: sdk.loadTossPayments,
}));

vi.mock("@/shared/config/env", () => ({
  E2E_MOCK_TOSS: false,
  TOSS_CLIENT_KEY: "test-client-key",
}));

import { PaymentWidget } from "./payment-widget";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("PaymentWidget", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("syncs an amount change that happens while the widget is rendering", async () => {
    const rendering = deferred();
    const widgets = {
      setAmount: vi.fn().mockResolvedValue(undefined),
      renderPaymentMethods: vi.fn(() => rendering.promise),
      renderAgreement: vi.fn().mockResolvedValue(undefined),
      requestPayment: vi.fn(),
    };
    sdk.loadTossPayments.mockResolvedValue({
      widgets: vi.fn(() => widgets),
    });
    const onReadyChange = vi.fn();
    const view = render(
      <PaymentWidget
        amount={10_000}
        customerKey="customer-1"
        onReadyChange={onReadyChange}
      />,
    );

    await waitFor(() =>
      expect(widgets.setAmount).toHaveBeenCalledWith({
        currency: "KRW",
        value: 10_000,
      }),
    );

    view.rerender(
      <PaymentWidget
        amount={20_000}
        customerKey="customer-1"
        onReadyChange={onReadyChange}
      />,
    );
    await act(async () => rendering.resolve());

    await waitFor(() => {
      expect(widgets.setAmount).toHaveBeenLastCalledWith({
        currency: "KRW",
        value: 20_000,
      });
      expect(onReadyChange).toHaveBeenLastCalledWith(true);
    });
  });
});
