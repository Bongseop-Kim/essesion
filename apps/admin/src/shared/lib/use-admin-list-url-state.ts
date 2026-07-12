import { useRef } from "react";
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

  const replaceQuery = (changes: Partial<AdminListQuery>) => {
    const next = { ...latestQuery.current, ...changes };
    latestQuery.current = next;
    setParams(serializeAdminListQuery(next), {
      replace: true,
    });
  };

  return { query, replaceQuery };
}
