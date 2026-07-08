import type { ReactNode } from "react";

import { Box } from "./box";
import { Field } from "./field";
import { Flex } from "./flex";
import { Float } from "./float";
import { ImageFrame } from "./image-frame";
import { XGlyph } from "./internal/glyphs";
import { Text } from "./text";

export type AttachmentItem = {
  id: string;
  src: string;
  alt?: string;
};

export type AttachmentDisplayFieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  items: AttachmentItem[];
  /** 표시할 경우 우측에 items.length/max 카운터 노출 */
  max?: number;
  /** 지정 시 각 썸네일에 제거 버튼 노출 */
  onRemove?: (id: string) => void;
  /** 썸네일 한 변 px */
  size?: number;
  className?: string;
};

export function AttachmentDisplayField({
  label,
  description,
  errorMessage,
  items,
  max,
  onRemove,
  size = 72,
  className,
}: AttachmentDisplayFieldProps) {
  const content = (
    <Flex
      direction="column"
      gap="x2"
      alignItems="stretch"
      className={className}
    >
      <Flex wrap="wrap" gap="x2">
        {items.map((item) => (
          <Box
            key={item.id}
            position="relative"
            width={size}
            height={size}
            overflow="visible"
          >
            <ImageFrame
              ratio={1}
              borderRadius="r2"
              stroke
              src={item.src}
              alt={item.alt}
            />
            {onRemove != null && (
              // Float 오프셋은 양수 토큰만 지원 — 살짝 밖으로 겹치도록 transform 재량.
              <Float
                placement="top-end"
                style={{ transform: "translate(30%, -30%)" }}
              >
                <button
                  type="button"
                  aria-label={`${item.alt ?? "첨부 이미지"} 삭제`}
                  onClick={() => onRemove(item.id)}
                  className="flex size-5 items-center justify-center rounded-full bg-bg-brand-solid text-fg-contrast shadow-s1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                >
                  <XGlyph className="size-3" />
                </button>
              </Float>
            )}
          </Box>
        ))}
      </Flex>
      {max != null && (
        <Text
          as="div"
          textStyle="captionSm"
          color="fg.neutral-subtle"
          align="end"
        >
          {items.length}/{max}
        </Text>
      )}
    </Flex>
  );
  if (label == null && description == null && errorMessage == null) {
    return content;
  }
  return (
    <Field label={label} description={description} errorMessage={errorMessage}>
      {content}
    </Field>
  );
}
