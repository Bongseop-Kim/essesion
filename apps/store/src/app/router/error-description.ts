import { isRouteErrorResponse } from "react-router";

export function routeErrorDescription(error: unknown) {
  return isRouteErrorResponse(error)
    ? `요청을 처리하지 못했습니다. (${error.status})`
    : "예상하지 못한 오류가 발생했습니다.";
}
