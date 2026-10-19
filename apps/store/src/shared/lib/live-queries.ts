import { listDesignExamplesOptions } from "@essesion/api-client/query";

/**
 * store 전역 focus 정책과 별개로 이 값들은 항상 stale로 유지한다.
 * admin 탭에서 값을 바꾼 뒤 store 탭으로 돌아오는 것이 유일한 반영 경로인 데이터에만 쓴다.
 */
export const FOCUS_REFETCH = {
  staleTime: 0,
  refetchOnWindowFocus: true,
} as const;

/**
 * 첫 진입 디자인 예시 갤러리 — 공개 조회라 비로그인에도 뜬다.
 *
 * admin에서 순서·게시 여부를 바꾸면 store 탭 복귀만으로 갱신돼야 한다(e2e-02 FAIL 1).
 * 목록이 6건 수준이라 다른 invalidation에서도 즉시 재조회해도 비용은 무시할 수 있다.
 */
export function designExamplesQueryOptions() {
  return { ...listDesignExamplesOptions(), ...FOCUS_REFETCH };
}
