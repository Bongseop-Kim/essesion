import type { ListGenerationJobsData } from "@essesion/api-client";
import {
  getDesignSessionOptions,
  getDesignSessionQueryKey,
  getGenerationJobOptions,
  getGenerationJobQueryKey,
  getTokenBalanceOptions,
  listDesignSessionsOptions,
  listDesignTurnsOptions,
  listDesignTurnsQueryKey,
  listGenerationJobsOptions,
  listGenerationJobsQueryKey,
} from "@essesion/api-client/query";

export type GenerationJobFilters = NonNullable<ListGenerationJobsData["query"]>;

type AuthenticatedResource = {
  authenticated: boolean;
};

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
}: AuthenticatedResource & { sessionId: string | null }) {
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
}: AuthenticatedResource & { sessionId: string | null }) {
  return {
    ...listDesignTurnsOptions({ path: { session_id: sessionId ?? "" } }),
    enabled: authenticated && !!sessionId,
  };
}

export const generationJobsQueryKey = (filters?: GenerationJobFilters) =>
  listGenerationJobsQueryKey(filters ? { query: filters } : undefined);

export function generationJobsQueryOptions({
  filters,
  authenticated,
}: AuthenticatedResource & { filters?: GenerationJobFilters }) {
  return {
    ...listGenerationJobsOptions(filters ? { query: filters } : undefined),
    enabled: authenticated,
  };
}

export const generationJobQueryKey = (jobId: string) =>
  getGenerationJobQueryKey({ path: { job_id: jobId } });

export function generationJobQueryOptions({
  jobId,
  authenticated,
}: AuthenticatedResource & { jobId: string | null }) {
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
