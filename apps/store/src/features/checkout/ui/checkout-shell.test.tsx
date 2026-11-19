// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./payment-widget", () => ({
  PaymentWidget: ({
    onReadyChange,
  }: {
    onReadyChange: (ready: boolean) => void;
  }) => {
    onReadyChange(true);
    return <div data-testid="widget" />;
  },
}));

vi.mock("@/shared/ui/content-layout", () => ({
  ContentLayout: ({
    sidebar,
    actionBar,
  }: {
    sidebar: React.ReactNode;
    actionBar: React.ReactNode;
  }) => (
    <>
      {sidebar}
      {actionBar}
    </>
  ),
}));

import { CheckoutShell } from "./checkout-shell";

const BAR_TOP = 700;

/** 위젯 영역(위젯의 부모)의 바닥과 결제 버튼 바(버튼의 부모)의 윗변을 정한다. */
function layout(widgetBottom: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      const isWidgetArea = this.querySelector(":scope > [data-testid=widget]");
      return {
        bottom: isWidgetArea ? widgetBottom : BAR_TOP + 80,
        top: isWidgetArea ? widgetBottom - 400 : BAR_TOP,
      } as DOMRect;
    },
  );
}

function renderShell() {
  const onPay = vi.fn();
  render(
    <CheckoutShell
      amount={16_000}
      breadcrumbs={[]}
      customerKey="customer-1"
      onPay={onPay}
      payDisabled={false}
      payLoading={false}
      summary={null}
    >
      {null}
    </CheckoutShell>,
  );
  return { onPay, button: screen.getByRole("button", { name: /결제하기/ }) };
}

describe("CheckoutShell", () => {
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
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
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("결제 수단이 바에 가려 있으면 첫 클릭은 스크롤만 한다", () => {
    layout(BAR_TOP + 300);
    const { onPay, button } = renderShell();
    fireEvent.click(button);
    expect(onPay).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("좌표가 그대로여도 두 번째 클릭은 결제한다", () => {
    layout(BAR_TOP + 300);
    const { onPay, button } = renderShell();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("결제 수단이 바 위로 다 보이면 첫 클릭에 결제한다", () => {
    layout(BAR_TOP - 16);
    const { onPay, button } = renderShell();
    fireEvent.click(button);
    expect(onPay).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
