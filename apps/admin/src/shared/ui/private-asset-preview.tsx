import {
  ActionButton,
  Box,
  Callout,
  HStack,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import { type ReactNode, useEffect, useRef } from "react";

type PrivateAssetPreviewProps = {
  src?: string;
  alt: string;
  metadata: ReactNode;
  loading: boolean;
  error: boolean;
  errorDescription: string;
  onRequest: () => void;
};

export function PrivateAssetPreview({
  src,
  alt,
  metadata,
  loading,
  error,
  errorDescription,
  onRequest,
}: PrivateAssetPreviewProps) {
  // 발급은 서버 캐시 뒤에 있어 이미지당 GCS Class B 요청 1건 수준이다 — 버튼을 누르게
  // 할 이유가 없다. 호출자마다 반복하지 않도록 여기서 한 번만 자동 요청한다.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    // 한 틱 미룬다 — 자식 effect는 부모보다 먼저 도는데, 호출자의 mutation 구독이
    // 그 부모 effect에서 붙는다. 즉시 호출하면 완료 알림을 놓쳐 버튼이 계속 로딩이다.
    setTimeout(onRequest, 0);
  }, [onRequest]);

  return (
    <VStack gap="x2" alignItems="stretch">
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
      <HStack gap="x2" justify="space-between" wrap>
        <Text textStyle="caption" color="fg.neutral-muted">
          {metadata}
        </Text>
        <ActionButton
          size="small"
          variant="neutralOutline"
          loading={loading}
          data-capture-hide
          onClick={onRequest}
        >
          URL 재발급
        </ActionButton>
      </HStack>
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
