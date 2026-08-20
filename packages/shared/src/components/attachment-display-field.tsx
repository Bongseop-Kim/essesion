import { type ChangeEvent, type ReactNode, useId, useState } from "react";

import type { ResponsiveValue } from "../breakpoint";
import { cn } from "../cn";
import { Box } from "./box";
import { Field, useFieldContext } from "./field";
import { Flex } from "./flex";
import { Float } from "./float";
import { ImageFrame } from "./image-frame";
import { focusRing } from "./internal/focus-ring";
import { PlusGlyph, XGlyph } from "./internal/glyphs";
import { Modal } from "./modal";
import { Text } from "./text";

export type AttachmentItem = {
  id: string;
  /** 없으면 ImageFrame 실루엣 폴백 — 빈 문자열 대신 undefined로 전달할 것 */
  src?: string;
  alt?: string;
};

export type AttachmentDisplayFieldProps = {
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  /** 첨부 썸네일 앞에 함께 노출할 피커 등 보조 컨트롤 */
  pickerSlot?: ReactNode;
  items: AttachmentItem[];
  /** 최대 첨부 수. 2 이상이면 우측에 items.length/max 카운터 노출 */
  max?: number;
  /** 지정 시 각 썸네일에 제거 버튼 노출 */
  onRemove?: (id: string) => void;
  /** 지정 시 남은 첨부 슬롯을 파일 선택 타일로 노출 */
  onAddFiles?: (files: File[]) => void;
  /**
   * 썸네일 클릭 시 확대 Modal을 연다. **페이지 컨텍스트에서만 켤 것** —
   * 모달 안 사용처에서 켜면 "모달 위 모달 금지"(overlay.md) 위반이다.
   */
  previewable?: boolean;
  accept?: string;
  addLabel?: string;
  /** 썸네일 한 변 px — 반응형 지정 가능 */
  size?: ResponsiveValue<number>;
  className?: string;
};

export function AttachmentDisplayField({
  label,
  description,
  errorMessage,
  pickerSlot,
  items,
  max,
  onRemove,
  onAddFiles,
  accept,
  addLabel = "이미지 추가",
  previewable = false,
  size = { base: 80, md: 112 },
  className,
}: AttachmentDisplayFieldProps) {
  const generatedId = useId();
  const inputId = `attachment-${generatedId.replaceAll(":", "")}`;
  const canAdd = onAddFiles != null && (max == null || items.length < max);
  const [previewId, setPreviewId] = useState<string | null>(null);
  // 확대 중 제거되면 항목이 사라져 Modal도 함께 닫힌다.
  const preview = previewable
    ? (items.find((item) => item.id === previewId) ?? null)
    : null;
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
      {pickerSlot}
      <Flex wrap="wrap" gap="x2">
        {items.map((item) => (
          <Box
            key={item.id}
            position="relative"
            width={size}
            height={size}
            overflow="visible"
          >
            {previewable ? (
              <Box
                as="button"
                type="button"
                aria-label={`${item.alt ?? "첨부 이미지"} 확대`}
                // src가 빈 레거시 항목은 확대할 원본이 없다.
                disabled={!item.src}
                onClick={() => setPreviewId(item.id)}
                width="full"
                borderRadius="r2"
                className={cn("block", focusRing)}
              >
                <ImageFrame
                  ratio={1}
                  borderRadius="r2"
                  stroke
                  src={item.src}
                  alt={item.alt}
                />
              </Box>
            ) : (
              <ImageFrame
                ratio={1}
                borderRadius="r2"
                stroke
                src={item.src}
                alt={item.alt}
              />
            )}
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
                  className={cn(
                    "text-fg-contrast focus-visible:outline",
                    focusRing,
                  )}
                >
                  <XGlyph className="size-3" />
                </Flex>
              </Float>
            )}
          </Box>
        ))}
        {canAdd && (
          <AddFileTile
            inputId={inputId}
            accept={accept}
            multiple={max !== 1}
            addLabel={addLabel}
            size={size}
            onChange={handleAddFiles}
          />
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
      {previewable && (
        <Modal
          open={preview != null}
          onOpenChange={(next) => {
            if (!next) setPreviewId(null);
          }}
          aria-label={`${preview?.alt ?? "첨부 이미지"} 확대`}
          showCloseButton
        >
          {preview != null && (
            <ImageFrame
              ratio="auto"
              borderRadius="r2"
              src={preview.src}
              alt={preview.alt ?? "첨부 이미지"}
            />
          )}
        </Modal>
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

/** 파일 선택 타일 — Field 컨텍스트에서 aria-invalid/aria-describedby를 가져간다(TextField와 동일 패턴). */
function AddFileTile({
  inputId,
  accept,
  multiple,
  addLabel,
  size,
  onChange,
}: {
  inputId: string;
  accept?: string;
  multiple: boolean;
  addLabel: string;
  size: ResponsiveValue<number>;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const field = useFieldContext();
  return (
    <Box position="relative" width={size} height={size}>
      <input
        id={inputId}
        type="file"
        accept={accept}
        multiple={multiple}
        aria-label={addLabel}
        aria-invalid={field?.invalid || undefined}
        aria-describedby={field?.describedBy}
        className="peer sr-only"
        onChange={onChange}
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
        className="cursor-pointer border border-dashed border-stroke-neutral bg-bg-layer-default text-fg-neutral-subtle transition-colors duration-(--duration-fast) ease-standard hover:bg-bg-neutral-weak peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-stroke-focus-ring"
      >
        <PlusGlyph className="size-6" />
      </Flex>
    </Box>
  );
}
