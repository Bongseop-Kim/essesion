import {
  ActionButton,
  Box,
  Callout,
  HStack,
  ImageFrame,
  Text,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";

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
          <Text color="fg.neutral-muted">미리보기 URL을 요청해 주세요.</Text>
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
          onClick={onRequest}
        >
          {src ? "URL 재발급" : "이미지 보기"}
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
