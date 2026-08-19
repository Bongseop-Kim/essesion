/** PostHog 제품 분석 — 퍼널·세션 리플레이용. 유입 채널은 GA4(`analytics.ts`)가 본다.
 * 두 모듈은 서로 독립적으로 켜지고 꺼진다.
 *
 * PII 금지 규약은 `analytics.ts`와 동일하다. 여기서 추가로 지키는 것 두 가지:
 * - URL 쿼리를 이벤트에서 제거한다 (OAuth code·paymentKey 유출 방지).
 * - 개인정보가 렌더되는 화면은 `ph-no-capture`로 통째로 가린다 (`app-layout.tsx`). */

import { withoutQuery } from "@/shared/lib/observability";

const projectKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const apiHost =
  import.meta.env.VITE_POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
let initialized = false;

// posthog-js는 무겁고 키가 없으면 불필요 — observability.ts와 같은 지연 로드 패턴.
let posthogModule: Promise<typeof import("posthog-js")> | null = null;
const loadPosthog = () => (posthogModule ??= import("posthog-js"));

/** URL이 들어가는 자동 수집 속성 — 전부 쿼리를 떼고 보낸다. */
const URL_PROPERTIES = [
  "$current_url",
  "$referrer",
  "$initial_current_url",
  "$initial_referrer",
];

/** 배송지·연락처·주문 내역이 화면에 렌더되는 경로. 요소마다 마스킹을 붙이지 않는 이유는
 * 화면이 늘 때 누락이 곧 개인정보 유출이기 때문 — 경로 하나로 막는 편이 검토하기 쉽다. */
const REPLAY_MASKED_PREFIXES = ["/order", "/my-page", "/login", "/auth"];

/** true면 그 화면을 `ph-no-capture`로 통째로 가린다(`app-layout.tsx`). */
export function isReplayMaskedPath(pathname: string) {
  return REPLAY_MASKED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** 키가 없는 로컬·테스트에서는 완전한 no-op이다. */
export function initProductAnalytics() {
  if (!projectKey || initialized) return;
  initialized = true;
  void loadPosthog().then(({ default: posthog }) => {
    posthog.init(projectKey, {
      api_host: apiHost,
      // 스니펫이 지정한 기본값 세트 — 최신 안전 기본값(마스킹 포함)이 여기에 묶여 있다.
      defaults: "2026-05-30",
      person_profiles: "identified_only",
      before_send: (event) => {
        if (!event?.properties) return event;
        for (const key of URL_PROPERTIES) {
          const value = event.properties[key];
          if (typeof value === "string")
            event.properties[key] = withoutQuery(value);
        }
        return event;
      },
    });
  });
}

/** GA4 `trackEvent`와 같은 이름·파라미터로 흘린다 — 이벤트 스키마는 analytics.ts가 정본. */
export function captureProductEvent(
  name: string,
  params: Record<string, unknown>,
) {
  if (!initialized) return;
  void loadPosthog().then(({ default: posthog }) => {
    posthog.capture(name, params);
  });
}

/** SPA 라우트 전환. `$pageview`는 PostHog이 URL 변화를 직접 감지하지 못하므로 수동 발화한다. */
export function captureProductPageView(pathname: string) {
  if (!initialized) return;
  void loadPosthog().then(({ default: posthog }) => {
    posthog.capture("$pageview", {
      $current_url: window.location.origin + pathname,
    });
  });
}
