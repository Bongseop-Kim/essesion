// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const productAnalytics = vi.hoisted(() => ({
  captureProductEvent: vi.fn(),
  captureProductPageView: vi.fn(),
}));
vi.mock("@/shared/lib/product-analytics", () => productAnalytics);

const GTAG_SCRIPT_SELECTOR = 'script[src^="https://www.googletagmanager.com"]';

async function loadAnalytics(measurementId: string) {
  vi.stubEnv("VITE_GA_MEASUREMENT_ID", measurementId);
  return await import("./analytics");
}

describe("analytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    delete window.dataLayer;
    delete window.gtag;
    document.head.querySelector(GTAG_SCRIPT_SELECTOR)?.remove();
  });

  it("측정 ID가 없으면 완전한 no-op이다", async () => {
    const { initAnalytics, trackEvent, trackPageView } =
      await loadAnalytics("");
    initAnalytics();
    trackPageView("/shop");
    trackEvent("login", { method: "password" });
    expect(window.dataLayer).toBeUndefined();
    expect(window.gtag).toBeUndefined();
    expect(document.querySelector(GTAG_SCRIPT_SELECTOR)).toBeNull();
  });

  it("측정 ID가 있으면 gtag를 로드하고 이벤트를 dataLayer에 쌓는다", async () => {
    const { initAnalytics, trackEvent, trackPageView } =
      await loadAnalytics("G-TEST1234");
    initAnalytics();
    const script =
      document.querySelector<HTMLScriptElement>(GTAG_SCRIPT_SELECTOR);
    expect(script?.src).toContain("id=G-TEST1234");
    const initialLength = window.dataLayer?.length ?? 0;

    trackPageView("/shop");
    trackEvent("purchase", {
      currency: "KRW",
      value: 10_000,
      transaction_id: "ORD-TEST-000001",
    });
    expect(window.dataLayer).toHaveLength(initialLength + 2);
  });

  it("transaction_id는 GA에만 가고 PostHog 전달에서는 제거된다", async () => {
    const { initAnalytics, trackEvent } = await loadAnalytics("G-TEST1234");
    initAnalytics();
    trackEvent("purchase", {
      currency: "KRW",
      value: 10_000,
      transaction_id: "ORD-TEST-000001",
    });
    expect(productAnalytics.captureProductEvent).toHaveBeenCalledWith(
      "purchase",
      { currency: "KRW", value: 10_000 },
    );
    const gaEvent = Array.from(window.dataLayer?.at(-1) as ArrayLike<unknown>);
    expect(gaEvent[2]).toMatchObject({ transaction_id: "ORD-TEST-000001" });
  });

  it("동적 주문 경로의 UUID는 양쪽 모두에서 치환된다", async () => {
    const { initAnalytics, trackPageView } = await loadAnalytics("G-TEST1234");
    initAnalytics();
    trackPageView(
      "/order/3f0e2a1b-9c4d-4e5f-8a6b-7c8d9e0f1a2b/repair-shipping",
    );
    expect(productAnalytics.captureProductPageView).toHaveBeenCalledWith(
      "/order/:id/repair-shipping",
    );
    const gaEvent = Array.from(window.dataLayer?.at(-1) as ArrayLike<unknown>);
    expect(gaEvent[2]).toMatchObject({
      page_path: "/order/:id/repair-shipping",
    });
  });
});
