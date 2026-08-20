// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();
const capture = vi.fn();

vi.mock("posthog-js", () => ({ default: { init, capture } }));

async function loadProductAnalytics(key: string) {
  vi.stubEnv("VITE_POSTHOG_KEY", key);
  return await import("./product-analytics");
}

/** init에 넘어간 before_send를 꺼내 직접 돌린다 — 쿼리 제거가 이 모듈의 유일한 비자명 로직이다. */
function beforeSend(): (event: unknown) => unknown {
  const config = init.mock.calls.at(0)?.at(1);
  return config.before_send;
}

describe("product-analytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    init.mockClear();
    capture.mockClear();
  });

  it("개인정보가 렌더되는 경로를 리플레이 마스킹 대상으로 판정한다", async () => {
    const { isReplayMaskedPath } = await loadProductAnalytics("");
    for (const path of [
      "/order",
      "/order/ORD-1",
      "/order/payment/success",
      "/my-page",
      "/my-page/shipping",
      "/login",
      "/auth/callback",
    ])
      expect(isReplayMaskedPath(path)).toBe(true);

    // 리플레이의 목적인 화면들 — 여기가 가려지면 도입 이유가 사라진다
    for (const path of ["/", "/design", "/shop", "/shop/1", "/cart", "/reform"])
      expect(isReplayMaskedPath(path)).toBe(false);
  });

  it("키가 없으면 완전한 no-op이다", async () => {
    const {
      initProductAnalytics,
      captureProductEvent,
      captureProductPageView,
    } = await loadProductAnalytics("");
    initProductAnalytics();
    captureProductEvent("purchase", { value: 10_000 });
    captureProductPageView("/shop");
    await vi.waitFor(() => {
      expect(init).not.toHaveBeenCalled();
      expect(capture).not.toHaveBeenCalled();
    });
  });

  it("키가 있으면 init하고 이벤트를 흘린다", async () => {
    const { initProductAnalytics, captureProductEvent } =
      await loadProductAnalytics("phc_test");
    initProductAnalytics();
    await vi.waitFor(() =>
      expect(init).toHaveBeenCalledWith(
        "phc_test",
        expect.objectContaining({ api_host: "https://us.i.posthog.com" }),
      ),
    );

    captureProductEvent("purchase", { value: 10_000 });
    await vi.waitFor(() =>
      expect(capture).toHaveBeenCalledWith("purchase", { value: 10_000 }),
    );
  });

  it("before_send가 URL 속성에서 쿼리·프래그먼트를 떼어낸다", async () => {
    const { initProductAnalytics } = await loadProductAnalytics("phc_test");
    initProductAnalytics();
    await vi.waitFor(() => expect(init).toHaveBeenCalled());

    const event = beforeSend()({
      properties: {
        // paymentKey·OAuth code가 URL을 타고 나가면 안 된다
        $current_url:
          "https://essesion.shop/order/payment/success?paymentKey=SECRET&orderId=ORD-1",
        $referrer: "https://essesion.shop/login?code=SECRET#state",
        $other: "손대지 않는다",
      },
    }) as { properties: Record<string, string> };

    expect(event.properties.$current_url).toBe(
      "https://essesion.shop/order/payment/success",
    );
    expect(event.properties.$referrer).toBe("https://essesion.shop/login");
    expect(event.properties.$other).toBe("손대지 않는다");
  });
});
