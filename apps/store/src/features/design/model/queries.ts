import type { GenerationJobOut } from "@essesion/api-client";
import {
  getDesignSessionOptions,
  getDesignSessionQueryKey,
  listDesignSessionsOptions,
  listDesignTurnsOptions,
  listDesignTurnsQueryKey,
  listGenerationJobsInfiniteOptions,
} from "@essesion/api-client/query";

export const FINALIZED_JOBS_PAGE_SIZE = 20;

export function designSessionsQueryOptions(authenticated: boolean) {
  return {
    ...listDesignSessionsOptions(),
    enabled: authenticated,
  };
}

export const designSessionQueryKey = (sessionId: string) =>
  getDesignSessionQueryKey({ path: { session_id: sessionId } });

export function designSessionQueryOptions({
  sessionId,
  authenticated,
}: {
  authenticated: boolean;
  sessionId: string | null;
}) {
  return {
    ...getDesignSessionOptions({ path: { session_id: sessionId ?? "" } }),
    enabled: authenticated && !!sessionId,
  };
}

export const designTurnsQueryKey = (sessionId: string) =>
  listDesignTurnsQueryKey({ path: { session_id: sessionId } });

export function designTurnsQueryOptions({
  sessionId,
  authenticated,
}: {
  authenticated: boolean;
  sessionId: string | null;
}) {
  return {
    ...listDesignTurnsOptions({ path: { session_id: sessionId ?? "" } }),
    enabled: authenticated && !!sessionId,
  };
}

export function finalizedJobsInfiniteQueryOptions(authenticated: boolean) {
  return {
    ...listGenerationJobsInfiniteOptions({
      query: {
        kind: "finalize",
        status: "succeeded",
        limit: FINALIZED_JOBS_PAGE_SIZE,
      },
    }),
    enabled: authenticated,
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: GenerationJobOut[],
      allPages: GenerationJobOut[][],
    ) =>
      lastPage.length === FINALIZED_JOBS_PAGE_SIZE
        ? allPages.length * FINALIZED_JOBS_PAGE_SIZE
        : undefined,
  };
}
