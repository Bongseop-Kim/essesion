export type AdminListQuery = {
  page: number;
  limit: 20 | 50 | 100;
  sort?: string;
  direction: "asc" | "desc";
  status?: string;
  type?: string;
  from?: string;
  to?: string;
  tab?: string;
};

export type AdminListQueryOptions = {
  allowedSorts?: readonly string[];
  allowedStatuses?: readonly string[];
  allowedTypes?: readonly string[];
  allowedTabs?: readonly string[];
  defaultSort?: string;
  defaultDirection?: "asc" | "desc";
};

function enumValue(value: string | null, allowed?: readonly string[]) {
  if (value === null) return undefined;
  return allowed?.includes(value) ? value : undefined;
}

function isoDate(value: string | null) {
  return value !== null && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? value
    : undefined;
}

function positiveInteger(value: string | null, fallback: number) {
  if (value === null || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pageLimit(value: string | null): AdminListQuery["limit"] {
  const parsed = positiveInteger(value, 20);
  return parsed === 50 || parsed === 100 ? parsed : 20;
}

/** PII 검색어를 받지 않는 비민감 목록 URL 계약만 파싱한다. */
export function parseAdminListQuery(
  params: URLSearchParams,
  options: AdminListQueryOptions = {},
): AdminListQuery {
  return {
    page: positiveInteger(params.get("page"), 1),
    limit: pageLimit(params.get("limit")),
    sort:
      enumValue(params.get("sort"), options.allowedSorts) ??
      options.defaultSort,
    direction:
      params.get("direction") === "asc" || params.get("direction") === "desc"
        ? (params.get("direction") as "asc" | "desc")
        : (options.defaultDirection ?? "asc"),
    status: enumValue(params.get("status"), options.allowedStatuses),
    type: enumValue(params.get("type"), options.allowedTypes),
    from: isoDate(params.get("from")),
    to: isoDate(params.get("to")),
    tab: enumValue(params.get("tab"), options.allowedTabs),
  };
}

/** 정의된 비민감 키만 직렬화하므로 q/email/phone/name은 URL에 남지 않는다. */
export function serializeAdminListQuery(query: AdminListQuery) {
  const params = new URLSearchParams();
  if (query.page > 1) params.set("page", String(query.page));
  if (query.limit !== 20) params.set("limit", String(query.limit));
  if (query.sort !== undefined) params.set("sort", query.sort);
  if (query.direction === "desc") params.set("direction", query.direction);
  if (query.status !== undefined) params.set("status", query.status);
  if (query.type !== undefined) params.set("type", query.type);
  if (query.from !== undefined) params.set("from", query.from);
  if (query.to !== undefined) params.set("to", query.to);
  if (query.tab !== undefined) params.set("tab", query.tab);
  return params;
}
