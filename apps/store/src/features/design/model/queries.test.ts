import type { GenerationJobOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import {
  FINALIZED_JOBS_PAGE_SIZE,
  finalizedJobsInfiniteQueryOptions,
} from "./queries";

function pageOf(length: number) {
  return Array.from({ length }, () => ({}) as GenerationJobOut);
}

describe("finalizedJobsInfiniteQueryOptions", () => {
  it("완성본 필터와 첫 offset을 고정한다", () => {
    const options = finalizedJobsInfiniteQueryOptions(true);

    expect(options.enabled).toBe(true);
    expect(options.initialPageParam).toBe(0);
    expect(options.queryKey[0]).toMatchObject({
      _id: "listGenerationJobs",
      _infinite: true,
      query: {
        kind: "finalize",
        status: "succeeded",
        limit: FINALIZED_JOBS_PAGE_SIZE,
      },
    });
  });

  it("가득 찬 페이지 뒤의 offset만 계산한다", () => {
    const { getNextPageParam } = finalizedJobsInfiniteQueryOptions(true);
    const firstPage = pageOf(FINALIZED_JOBS_PAGE_SIZE);
    const secondPage = pageOf(FINALIZED_JOBS_PAGE_SIZE);

    expect(getNextPageParam(firstPage, [firstPage])).toBe(
      FINALIZED_JOBS_PAGE_SIZE,
    );
    expect(getNextPageParam(secondPage, [firstPage, secondPage])).toBe(
      FINALIZED_JOBS_PAGE_SIZE * 2,
    );
    expect(
      getNextPageParam(pageOf(FINALIZED_JOBS_PAGE_SIZE - 1), [firstPage]),
    ).toBeUndefined();
  });
});
