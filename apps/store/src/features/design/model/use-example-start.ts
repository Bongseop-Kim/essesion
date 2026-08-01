import { createDesignSessionFromExample } from "@essesion/api-client";
import { listDesignSessionsQueryKey } from "@essesion/api-client/query";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey } from "./queries";

/** 예시에서 시작 — 서버가 렌더 없이 run을 복원하므로 토큰이 들지 않는다. */
export function useStartDesignFromExample() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (exampleId: string) => {
      const { data } = await createDesignSessionFromExample({
        body: { example_id: exampleId },
        throwOnError: true,
      });
      queryClient.setQueryData(designSessionQueryKey(data.id), data);
      await queryClient.invalidateQueries({
        queryKey: listDesignSessionsQueryKey(),
      });
      return data;
    },
  });
}
