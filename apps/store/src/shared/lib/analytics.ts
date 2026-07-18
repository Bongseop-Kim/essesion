/** GA4 계측 — gtag.js를 동적 로드한다(CSP nonce가 없어 인라인 스니펫 불가).
 * PII 금지: paymentKey·orderId 원문, 연락처, URL 쿼리를 이벤트에 넣지 않는다. */

const measurementId = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim();
let initialized = false;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

type GaItem = {
  item_id: string;
  item_name: string;
  price: number;
  quantity?: number;
  item_category?: string;
};

type GaEvents = {
  login: { method: "password" | "oauth" };
  view_item: { currency: "KRW"; value: number; items: GaItem[] };
  add_to_cart: { currency: "KRW"; value: number; items: GaItem[] };
  add_to_wishlist: { currency: "KRW"; value: number; items: GaItem[] };
  begin_checkout: { currency: "KRW"; value: number };
  purchase: { currency: "KRW"; value: number; transaction_id?: string };
  token_purchase: { currency: "KRW"; value: number; token_amount: number };
  generate_design: { mode: "prompt" | "variation" };
  quote_request: { quantity: number };
};

/** 측정 ID가 없는 로컬·테스트에서는 완전한 no-op이다. */
export function initAnalytics() {
  if (!measurementId || initialized) return;
  initialized = true;
  window.dataLayer = window.dataLayer ?? [];
  window.gtag = function gtag() {
    // biome-ignore lint/complexity/noArguments: gtag 계약이 배열이 아닌 arguments 객체 push를 요구한다
    window.dataLayer?.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false, // SPA 라우트 전환은 trackPageView가 담당
    debug_mode: import.meta.env.DEV || undefined,
  });
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
  document.head.append(script);
}

/** 쿼리스트링은 받지 않는다 — OAuth code·paymentKey 유출 방지. */
export function trackPageView(pathname: string) {
  if (!initialized) return;
  window.gtag?.("event", "page_view", {
    page_path: pathname,
    page_location: window.location.origin + pathname,
  });
}

export function trackEvent<K extends keyof GaEvents>(
  name: K,
  params: GaEvents[K],
) {
  if (!initialized) return;
  window.gtag?.("event", name, params);
}
