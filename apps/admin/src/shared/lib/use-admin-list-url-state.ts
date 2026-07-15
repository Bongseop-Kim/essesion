import { useCallback, useEffect, useRef } from "react";
import { useSearchParams } from "react-router";

import {
  type AdminListQuery,
  type AdminListQueryOptions,
  parseAdminListQuery,
  serializeAdminListQuery,
} from "./url-query";

export function useAdminListUrlState(options: AdminListQueryOptions = {}) {
  const [params, setParams] = useSearchParams();
  const query = parseAdminListQuery(params, options);
  const latestQuery = useRef(query);
  latestQuery.current = query;

  const replaceQuery = useCallback(
    (changes: Partial<AdminListQuery>) => {
      const next = { ...latestQuery.current, ...changes };
      latestQuery.current = next;
      setParams(serializeAdminListQuery(next), {
        replace: true,
      });
    },
    [setParams],
  );

  return { query, replaceQuery };
}

export function useAdminListPageCorrection({
  page,
  limit,
  total,
  ready,
  replaceQuery,
}: {
  page: number;
  limit: number;
  total: number | undefined;
  ready: boolean;
  replaceQuery: (changes: Partial<AdminListQuery>) => void;
}) {
  useEffect(() => {
    if (!ready || total === undefined) return;
    const lastPage = Math.max(1, Math.ceil(total / limit));
    if (page > lastPage) replaceQuery({ page: lastPage });
  }, [limit, page, ready, replaceQuery, total]);
}
