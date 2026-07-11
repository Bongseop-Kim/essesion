import type { CustomAmountRequest } from "@essesion/api-client";
import { calculateCustomOrder } from "@essesion/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

export function useCustomQuote(payload: CustomAmountRequest) {
  const [debounced, setDebounced] = useState(payload);
  const currentKey = useMemo(() => JSON.stringify(payload), [payload]);
  const debouncedKey = useMemo(() => JSON.stringify(debounced), [debounced]);
  const enabled =
    payload.quantity >= 4 &&
    payload.quantity <= 10_000 &&
    (payload.options.fabric_provided === true ||
      (!!payload.options.design_type && !!payload.options.fabric_type));

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(payload), 400);
    return () => window.clearTimeout(timeout);
  }, [payload]);

  const query = useQuery({
    queryKey: ["custom-order", "calculate", debounced],
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await calculateCustomOrder({
        body: debounced,
        throwOnError: true,
      });
      return data;
    },
  });

  return {
    ...query,
    isCurrent:
      enabled &&
      currentKey === debouncedKey &&
      !query.isFetching &&
      !query.isPlaceholderData &&
      query.data != null,
  };
}
