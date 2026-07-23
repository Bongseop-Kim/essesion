import type {
  GenerationJobOut,
  ListGenerationJobsData,
} from "@essesion/api-client";
import {
  getDesignSessionOptions,
  getDesignSessionQueryKey,
  getGenerationJobOptions,
  getGenerationJobQueryKey,
  getTokenBalanceOptions,
  listDesignSessionsOptions,
  listDesignTurnsOptions,
  listDesignTurnsQueryKey,
  listGenerationJobsInfiniteOptions,
  listGenerationJobsOptions,
} from "@essesion/api-client/query";

export type GenerationJobFilters = NonNullable<ListGenerationJobsData["query"]>;
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

export function generationJobsQueryOptions({
  filters,
  authenticated,
}: {
  authenticated: boolean;
  filters?: GenerationJobFilters;
}) {
  return {
    ...listGenerationJobsOptions(filters ? { query: filters } : undefined),
    enabled: authenticated,
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

export const generationJobQueryKey = (jobId: string) =>
  getGenerationJobQueryKey({ path: { job_id: jobId } });

export function generationJobQueryOptions({
  jobId,
  authenticated,
}: {
  authenticated: boolean;
  jobId: string | null;
}) {
  return {
    ...getGenerationJobOptions({ path: { job_id: jobId ?? "" } }),
    enabled: authenticated && !!jobId,
  };
}

export function designTokenBalanceQueryOptions(authenticated: boolean) {
  return {
    ...getTokenBalanceOptions(),
    enabled: authenticated,
  };
}
