import { createDesignSessionFromExample } from "@essesion/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey } from "./queries";

/** 템플릿에서 시작 — 서버가 렌더 없이 run을 복원한다. */
export function useStartDesignFromExample() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (exampleId: string) => {
      const { data } = await createDesignSessionFromExample({
        body: { example_id: exampleId },
        throwOnError: true,
      });
      queryClient.setQueryData(designSessionQueryKey(data.id), data);
      return data;
    },
  });
}
