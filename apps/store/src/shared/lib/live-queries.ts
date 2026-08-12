import {
  getTokenBalanceOptions,
  listDesignExamplesOptions,
} from "@essesion/api-client/query";

/**
 * store 전역 기본값(`shared/lib/query-client.ts`의 staleTime 5분 +
 * refetchOnWindowFocus false)을 덮어 window focus마다 서버를 다시 읽는다.
 * admin 탭에서 값을 바꾼 뒤 store 탭으로 돌아오는 것이 유일한 반영 경로인 데이터에만 쓴다.
 */
const FOCUS_REFETCH = { staleTime: 0, refetchOnWindowFocus: true } as const;

/**
 * 토큰 잔액·단가.
 *
 * 잔액·단가를 표시하는 화면은 raw `getTokenBalanceOptions()`를 직접 스프레드하지 말 것 —
 * 전역 기본값을 타면 admin이 `design_edit_cost` 같은 단가를 바꿔도 탭 복귀 후 최대 5분간
 * 옛 단가가 남는다(e2e-02 FAIL 2가 이 경로에서 재발했다).
 *
 * @param authenticated 비로그인 호출을 막는다. ProtectedRoute 하위 화면이면 생략한다.
 */
export function tokenBalanceQueryOptions(authenticated = true) {
  return {
    ...getTokenBalanceOptions(),
    ...FOCUS_REFETCH,
    enabled: authenticated,
  };
}

/**
 * 첫 진입 디자인 예시 갤러리 — 공개 조회라 비로그인에도 뜬다.
 *
 * admin에서 순서·게시 여부를 바꾸면 store 탭 복귀만으로 갱신돼야 한다(e2e-02 FAIL 1).
 * 목록이 6건 수준이라 focus마다 재조회해도 비용은 무시할 수 있다.
 */
export function designExamplesQueryOptions() {
  return { ...listDesignExamplesOptions(), ...FOCUS_REFETCH };
}
