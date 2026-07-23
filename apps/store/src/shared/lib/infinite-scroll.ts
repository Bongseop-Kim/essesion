import { type RefObject, useEffect } from "react";

/**
 * offset 페이지네이션의 `getNextPageParam`. 서버에서 `pageSize + 1`개를 받아
 * 마지막 페이지가 `pageSize`를 초과하면 다음 offset을, 아니면 undefined를 돌려준다.
 */
export function offsetPageParam(pageSize: number) {
  return (
    lastPage: { length: number },
    allPages: { length: number }[],
  ): number | undefined =>
    lastPage.length > pageSize ? allPages.length * pageSize : undefined;
}

type InfiniteScrollQuery = {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isFetchNextPageError?: boolean;
  fetchNextPage: () => unknown;
};

/** sentinel이 뷰포트에 들어오면 다음 페이지를 가져온다(모바일 무한 스크롤). */
export function useInfiniteScrollSentinel(
  ref: RefObject<HTMLElement | null>,
  query: InfiniteScrollQuery,
  enabled = true,
) {
  const {
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
  } = query;
  useEffect(() => {
    if (
      !enabled ||
      !hasNextPage ||
      isFetchingNextPage ||
      isFetchNextPageError
    ) {
      return;
    }
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [
    enabled,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    ref,
  ]);
}
