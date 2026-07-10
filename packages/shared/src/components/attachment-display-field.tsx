import { type ChangeEvent, type ReactNode, useId } from "react";

import { Box } from "./box";
import { Field } from "./field";
import { Flex } from "./flex";
import { Float } from "./float";
import { ImageFrame } from "./image-frame";
import { PlusGlyph, XGlyph } from "./internal/glyphs";
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
  /** 최대 첨부 수. 2 이상이면 우측에 items.length/max 카운터 노출 */
  max?: number;
  /** 지정 시 각 썸네일에 제거 버튼 노출 */
  onRemove?: (id: string) => void;
  /** 지정 시 남은 첨부 슬롯을 파일 선택 타일로 노출 */
  onAddFiles?: (files: File[]) => void;
  accept?: string;
  addLabel?: string;
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
  onAddFiles,
  accept,
  addLabel = "이미지 추가",
  size = 72,
  className,
}: AttachmentDisplayFieldProps) {
  const generatedId = useId();
  const inputId = `attachment-${generatedId.replaceAll(":", "")}`;
  const canAdd = onAddFiles != null && (max == null || items.length < max);
  const handleAddFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.currentTarget.files ?? []);
    const remaining =
      max == null ? selected.length : Math.max(0, max - items.length);
    const accepted = selected.slice(0, remaining);
    if (accepted.length > 0) onAddFiles?.(accepted);
    event.currentTarget.value = "";
  };
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
                <Flex
                  as="button"
                  type="button"
                  aria-label={`${item.alt ?? "첨부 이미지"} 삭제`}
                  onClick={() => onRemove(item.id)}
                  align="center"
                  justify="center"
                  width={20}
                  height={20}
                  borderRadius="full"
                  bg="bg.brand-solid"
                  boxShadow="s1"
                  className="text-fg-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                >
                  <XGlyph className="size-3" />
                </Flex>
              </Float>
            )}
          </Box>
        ))}
        {canAdd && (
          <Box position="relative" width={size} height={size}>
            <input
              id={inputId}
              type="file"
              accept={accept}
              multiple={max !== 1}
              aria-label={addLabel}
              className="peer sr-only"
              onChange={handleAddFiles}
            />
            <Flex
              as="label"
              htmlFor={inputId}
              aria-label={addLabel}
              align="center"
              justify="center"
              width="full"
              height="full"
              borderRadius="r2"
              className="cursor-pointer border border-dashed border-stroke-neutral text-fg-neutral-subtle transition-colors duration-100 ease-standard hover:bg-bg-neutral-weak peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring"
            >
              <PlusGlyph className="size-6" />
            </Flex>
          </Box>
        )}
      </Flex>
      {max != null && max > 1 && (
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
