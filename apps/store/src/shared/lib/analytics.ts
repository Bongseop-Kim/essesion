/** GA4 계측 — gtag.js를 동적 로드한다(CSP nonce가 없어 인라인 스니펫 불가).
 * PII 금지: paymentKey·orderId 원문, 연락처, URL 쿼리를 이벤트에 넣지 않는다.
 *
 * 같은 이벤트를 PostHog에도 흘린다(`product-analytics.ts`). 호출부는 이 모듈만 알면 되고,
 * 두 도구는 각자 환경변수로 독립적으로 꺼진다. 이벤트 스키마의 정본은 아래 `GaEvents`다. */

import {
  captureProductEvent,
  captureProductPageView,
} from "@/shared/lib/product-analytics";

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
  generate_design: { rejected: "0" | "1" };
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

/** 동적 경로의 UUID 세그먼트(주문 상세 등)를 치환한다 — orderId 원문 금지(위 PII 규약). */
const UUID_SEGMENT =
  /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi;

export function redactPath(pathname: string) {
  return pathname.replace(UUID_SEGMENT, "/:id");
}

/** 쿼리스트링은 받지 않는다 — OAuth code·paymentKey 유출 방지. */
export function trackPageView(pathname: string) {
  const path = redactPath(pathname);
  captureProductPageView(path);
  if (!initialized) return;
  window.gtag?.("event", "page_view", {
    page_path: path,
    page_location: window.location.origin + path,
  });
}

export function trackEvent<K extends keyof GaEvents>(
  name: K,
  params: GaEvents[K],
) {
  // transaction_id(주문번호)는 GA4 purchase dedup에만 필요하다 — PostHog에는 보내지 않는다.
  const { transaction_id: _omitted, ...productParams } =
    params as GaEvents[K] & {
      transaction_id?: string;
    };
  captureProductEvent(name, productParams);
  if (!initialized) return;
  window.gtag?.("event", name, params);
}
