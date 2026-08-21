import { Box, Callout, ImageFrame, Text, VStack } from "@essesion/shared";
import { type ReactNode, useEffect, useRef } from "react";

type PrivateAssetPreviewProps = {
  src?: string;
  alt: string;
  metadata: ReactNode;
  error: boolean;
  errorDescription: string;
  onRequest: () => void;
};

export function PrivateAssetPreview({
  src,
  alt,
  metadata,
  error,
  errorDescription,
  onRequest,
}: PrivateAssetPreviewProps) {
  // 발급은 서버 캐시 뒤에 있어 이미지당 GCS Class B 요청 1건 수준이다 — 버튼을 누르게
  // 할 이유가 없다. 호출자마다 반복하지 않도록 여기서 한 번만 자동 요청한다.
  // onRequest는 호출자마다 인라인 화살표라 매 렌더 새 값이다 — deps에 넣으면 재렌더의
  // cleanup이 아래 타이머를 취소해 요청이 영원히 안 나간다. ref로 최신 값만 읽는다.
  const request = useRef(onRequest);
  request.current = onRequest;
  useEffect(() => {
    // 한 틱 미룬다 — 자식 effect는 부모보다 먼저 도는데, 호출자의 mutation 구독이
    // 그 부모 effect에서 붙는다. 즉시 호출하면 완료 알림을 놓쳐 URL이 안 꽂힌다.
    const handle = setTimeout(() => request.current(), 0);
    return () => clearTimeout(handle);
  }, []);

  return (
    // ponytail: 모바일 한 손 폭에 맞춘 고정 상한 — 넓은 화면에서도 같은 크기다.
    <VStack gap="x2" alignItems="stretch" maxWidth={280}>
      {src ? (
        <ImageFrame src={src} alt={alt} ratio={4 / 3} fit="contain" stroke />
      ) : (
        <Box
          bg="bg.neutral-weak"
          borderRadius="r2"
          p="x6"
          className="grid min-h-32 place-items-center"
        >
          <Text color="fg.neutral-muted">
            {error
              ? "미리보기를 불러오지 못했습니다."
              : "미리보기를 불러오고 있습니다."}
          </Text>
        </Box>
      )}
      <Text textStyle="caption" color="fg.neutral-muted">
        {metadata}
      </Text>
      {error && (
        <Callout
          role="alert"
          tone="critical"
          title="이미지를 불러오지 못했습니다"
          description={errorDescription}
        />
      )}
    </VStack>
  );
}
