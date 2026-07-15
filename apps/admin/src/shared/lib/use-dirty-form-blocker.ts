import { useEffect } from "react";
import { useBlocker } from "react-router";

/**
 * 편집 화면이 공통 확인 UI를 연결할 수 있도록 navigation blocker를 반환한다.
 * 브라우저 종료/새로고침은 native beforeunload 경고로 보호한다.
 *
 * bypassRef를 넘기면 navigation 시점에 `.current`를 라이브로 읽어 차단을 건너뛴다.
 * 저장 성공 후 navigate() 직전에 `bypassRef.current = true`로 설정하면,
 * baseDraft 리셋 이펙트가 커밋되기 전이라도 저장하지 않은 변경 다이얼로그가 뜨지 않는다.
 */
export function useDirtyFormBlocker(
  isDirty: boolean,
  bypassRef?: { current: boolean },
) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirty &&
      !bypassRef?.current &&
      currentLocation.pathname !== nextLocation.pathname,
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
