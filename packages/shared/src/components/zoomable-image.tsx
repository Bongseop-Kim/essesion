import { useState } from "react";

import { cn } from "../cn";
import { Box } from "./box";
import { ImageFrame, type ImageFrameProps } from "./image-frame";
import { focusRing } from "./internal/focus-ring";
import { Modal } from "./modal";

export type ZoomableImageProps = Omit<ImageFrameProps, "fill"> & {
  /** 확대 때 쓸 더 큰 소스. 없으면 썸네일과 같은 src를 크게 띄운다. */
  zoom?: Pick<ImageFrameProps, "src" | "fallbackSrc">;
};

/**
 * 누르면 Modal로 크게 보여주는 ImageFrame. **페이지 컨텍스트에서만 쓸 것** —
 * 모달 안에서 쓰면 "모달 위 모달 금지"(overlay.md) 위반이다.
 */
export function ZoomableImage({ zoom, ...frame }: ZoomableImageProps) {
  const [open, setOpen] = useState(false);
  const label = `${frame.alt || "이미지"} 확대`;
  return (
    <>
      <Box
        as="button"
        type="button"
        aria-label={label}
        // src가 없으면(로딩 중·발급 실패) 확대할 원본이 없다.
        disabled={!frame.src}
        onClick={() => setOpen(true)}
        width="full"
        borderRadius="r2"
        className={cn("block", focusRing)}
      >
        <ImageFrame {...frame} />
      </Box>
      <Modal
        open={open}
        onOpenChange={setOpen}
        aria-label={label}
        showCloseButton
      >
        {open && (
          <ImageFrame
            ratio="auto"
            borderRadius="r2"
            src={zoom?.src ?? frame.src}
            fallbackSrc={zoom ? zoom.fallbackSrc : frame.fallbackSrc}
            alt={frame.alt}
          />
        )}
      </Modal>
    </>
  );
}
