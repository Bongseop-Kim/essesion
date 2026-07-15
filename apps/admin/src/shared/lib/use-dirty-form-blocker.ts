import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * 편집 화면이 공통 확인 UI를 연결할 수 있도록 navigation blocker를 반환한다.
 * 브라우저 종료/새로고침은 native beforeunload 경고로 보호한다.
 */
export function useDirtyFormBlocker(isDirty: boolean) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!isDirty) return;
    const preventUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventUnload);
    return () => window.removeEventListener("beforeunload", preventUnload);
  }, [isDirty]);

  return blocker;
}
