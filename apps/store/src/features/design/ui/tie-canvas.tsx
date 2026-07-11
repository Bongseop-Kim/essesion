import { Box, Flex } from "@essesion/shared";

export type DesignPreviewMode = "repeat" | "tie";

export type DesignPreviewTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  originX?: number;
  originY?: number;
};

export type TieCanvasProps = {
  /** Sanitized SVG encoded as a data URI. */
  imageSrc: string;
  mode: DesignPreviewMode;
  alt?: string;
  transform?: DesignPreviewTransform;
  className?: string;
};

const DEFAULT_TRANSFORM: DesignPreviewTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function TieCanvas({
  imageSrc,
  mode,
  alt = "선택한 디자인 미리보기",
  transform = DEFAULT_TRANSFORM,
  className,
}: TieCanvasProps) {
  const scale = Math.min(4, Math.max(1, transform.scale));
  const originX = transform.originX ?? 50;
  const originY = transform.originY ?? 50;
  const backgroundStyle = {
    backgroundImage: `url(${JSON.stringify(imageSrc)})`,
    backgroundRepeat: "repeat",
    backgroundSize: `${(mode === "repeat" ? 28 : 72) * scale}% auto`,
    backgroundPosition: `calc(${originX}% + ${transform.offsetX}px) calc(${originY}% + ${transform.offsetY}px)`,
  } as const;

  return (
    <Box
      position="relative"
      width="full"
      overflow="hidden"
      borderRadius="r4"
      bg="bg.neutral-weak"
      className={className}
      style={{ aspectRatio: 1 }}
    >
      {mode === "repeat" ? (
        <Box
          position="absolute"
          inset={0}
          role="img"
          aria-label={alt}
          className="transition-all duration-100 ease-standard"
          style={backgroundStyle}
        />
      ) : (
        <Flex
          position="absolute"
          inset={0}
          align="center"
          justify="center"
          p="x6"
        >
          <Box
            role="img"
            aria-label={`${alt}, 넥타이 적용 모습`}
            width="42%"
            height="88%"
            className="transition-all duration-100 ease-standard"
            style={{
              ...backgroundStyle,
              clipPath:
                "polygon(38% 0, 62% 0, 69% 12%, 61% 23%, 79% 76%, 50% 100%, 21% 76%, 39% 23%, 31% 12%)",
            }}
          />
        </Flex>
      )}
    </Box>
  );
}
