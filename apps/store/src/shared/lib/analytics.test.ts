// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

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
});
