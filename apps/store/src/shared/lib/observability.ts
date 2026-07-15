import * as Sentry from "@sentry/react";

const dsn = import.meta.env.VITE_SENTRY_DSN?.trim();
let initialized = false;

function withoutQuery(value: string | undefined) {
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
}

export function captureRouteError(error: unknown) {
  if (dsn) Sentry.captureException(error);
}

export function setRequestIdTag(requestId: string | null) {
  if (dsn && requestId) Sentry.setTag("request_id", requestId);
}
