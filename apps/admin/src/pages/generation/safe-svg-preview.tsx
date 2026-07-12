import { Callout, ImageFrame, Skeleton, VStack } from "@essesion/shared";
import { useEffect, useState } from "react";

export type SvgSafetyStatus = "safe" | "unavailable" | "unsafe";

export type SafeSvgPreviewProps = {
  svg: string | null;
  status: SvgSafetyStatus;
  alt: string;
};

export function SafeSvgPreview({ svg, status, alt }: SafeSvgPreviewProps) {
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (status !== "safe" || svg === null || svg === "") {
      setObjectUrl(undefined);
      return;
    }

    const url = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml;charset=utf-8" }),
    );
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [status, svg]);

  if (status === "unsafe") {
    return (
      <Callout
        tone="critical"
        title="안전하지 않은 SVG"
        description="서버 안전성 검사를 통과하지 못해 미리보기를 차단했습니다."
      />
    );
  }

  if (status === "unavailable" || svg === null || svg === "") {
    return (
      <Callout
        tone="neutral"
        title="SVG 미리보기 없음"
        description="저장된 SVG가 없거나 안전하게 제공할 수 없는 결과입니다."
      />
    );
  }

  return (
    <VStack gap="x2" alignItems="stretch" aria-live="polite">
      {objectUrl === undefined ? (
        <Skeleton width="100%" height={240} />
      ) : (
        <ImageFrame src={objectUrl} alt={alt} ratio={1} fit="contain" stroke />
      )}
    </VStack>
  );
}
