import { createReadUrl } from "@essesion/api-client";

/**
 * 업로드 자산 서명 read URL 쿼리 — 키를 객체 키로 통일해 같은 자산은 화면이
 * 달라도(장바구니·주문서·수선 접수 등) 캐시를 공유한다. staleTime은 서버 URL
 * TTL(15분)보다 짧은 10분 — 포커스마다 재발급 + 이미지 재다운로드를 막는다.
 */
export function signedReadUrlQueryOptions(
  objectKey: string,
  claimToken?: string | null,
) {
  return {
    queryKey: ["signed-read-url", objectKey] as const,
    queryFn: async () => {
      const response = await createReadUrl({
        body: { object_key: objectKey, claim_token: claimToken ?? undefined },
        throwOnError: true,
      });
      return response.data.read_url;
    },
    staleTime: 10 * 60 * 1000,
  };
}
