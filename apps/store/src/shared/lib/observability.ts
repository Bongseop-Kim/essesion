const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
let initialized = false;
// @sentry/react는 무겁고 DSN 없으면 아예 불필요 — 엔트리 청크에서 빼고 지연 로드한다.
let sentryModule: Promise<typeof import("@sentry/react")> | null = null;
const loadSentry = () => (sentryModule ??= import("@sentry/react"));

/** 쿼리·프래그먼트 제거 — OAuth code·paymentKey가 URL을 타고 새는 것을 막는다.
 * Sentry와 PostHog이 같은 규약을 공유한다. */
export function withoutQuery(value: string | undefined) {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value, window.location.origin);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

/** DSN이 없는 로컬·테스트에서는 완전한 no-op이다. */
export function initObservability() {
  if (!dsn || initialized) return;
  initialized = true;
  void loadSentry().then((Sentry) => {
    Sentry.init({
      dsn,
      environment:
        import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE,
      release: import.meta.env.VITE_SENTRY_RELEASE,
      sendDefaultPii: false,
      beforeSend(event) {
        // OAuth code·paymentKey 등 URL query와 인증 헤더가 이벤트에 섞이지 않게 한다.
        if (event.request) {
          event.request.url = withoutQuery(event.request.url);
          event.request.headers = undefined;
          event.request.cookies = undefined;
          event.request.data = undefined;
        }
        event.user = undefined;
        event.breadcrumbs = event.breadcrumbs?.map((breadcrumb) => ({
          ...breadcrumb,
          data: undefined,
        }));
        return event;
      },
    });
  });
}

export function captureRouteError(error: unknown) {
  // init보다 먼저 불려도 안전 — Sentry.init 전 capture는 SDK가 버퍼링한다.
  if (dsn) void loadSentry().then((Sentry) => Sentry.captureException(error));
}

export function setRequestIdTag(requestId: string | null) {
  if (dsn && requestId)
    void loadSentry().then((Sentry) => Sentry.setTag("request_id", requestId));
}
