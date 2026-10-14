import { applyColorway, placeDesignLogo } from "@essesion/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey } from "./queries";

/** 로고 넣기 — 서버가 내 모티프 저장과 슬롯 교체를 한 번에 한다. 재렌더뿐이라 토큰이 들지 않는다. */
export function usePlaceLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      name: string;
      svg: string;
    }) => {
      const { data } = await placeDesignLogo({
        path: { session_id: input.sessionId },
        body: { name: input.name.trim().slice(0, 100), svg: input.svg },
        throwOnError: true,
      });
      await queryClient.invalidateQueries({
        queryKey: designSessionQueryKey(input.sessionId),
      });
      return data;
    },
  });
}

/** 색 프리셋 적용 — intent의 colorway만 바꾼 재렌더라 토큰이 들지 않는다. */
export function useApplyColorway() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { sessionId: string; colorwayId: string }) => {
      const { data } = await applyColorway({
        path: { session_id: input.sessionId },
        body: { colorway_id: input.colorwayId },
        throwOnError: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(input.sessionId),
        }),
      ]);
      return data;
    },
  });
}
