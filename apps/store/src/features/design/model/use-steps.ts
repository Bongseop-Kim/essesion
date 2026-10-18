import {
  applyColorway,
  type DesignLogoSlotOut,
  placeDesignLogo,
} from "@essesion/api-client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { designSessionQueryKey } from "./queries";

/** 로고 넣기 — 서버가 내 모티프 저장과 로고 자리 교체를 한 번에 한다. 재렌더뿐이라 토큰이 들지 않는다. */
export function usePlaceLogo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      name: string;
      svg: string;
      /** 템플릿 로고 자리 — 생략하면 서버가 첫 자리를 고른다. */
      slot?: DesignLogoSlotOut["slot"];
    }) => {
      const { data } = await placeDesignLogo({
        path: { session_id: input.sessionId },
        body: {
          name: input.name.trim().slice(0, 100),
          svg: input.svg,
          slot: input.slot,
        },
        throwOnError: true,
      });
      await queryClient.invalidateQueries({
        queryKey: designSessionQueryKey(input.sessionId),
      });
      return data;
    },
  });
}

/** 부위별 색 적용 — 슬롯→hex. colorway만 바꾼 재렌더라 토큰이 들지 않는다. */
export function useApplyColorway() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      sessionId: string;
      colors: Record<string, string>;
    }) => {
      const { data } = await applyColorway({
        path: { session_id: input.sessionId },
        body: { colors: input.colors },
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
