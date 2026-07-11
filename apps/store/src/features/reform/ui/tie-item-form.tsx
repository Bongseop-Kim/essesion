import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Checkbox,
  Field,
  Flex,
  Float,
  HStack,
  Text,
  VStack,
} from "@essesion/shared";
import { useFormContext, useWatch } from "react-hook-form";
import { REFORM_IMAGE_ACCEPT } from "../api/upload";
import type { ReformFormValues, ReformTieForm } from "../model/reform";

export function TieItemForm({
  index,
  selected,
  cost,
  onSelectedChange,
  onEditOptions,
  onRemove,
}: {
  index: number;
  selected: boolean;
  cost: number;
  onSelectedChange: (selected: boolean) => void;
  onEditOptions: () => void;
  onRemove: () => void;
}) {
  const {
    control,
    clearErrors,
    setValue,
    formState: { errors },
  } = useFormContext<ReformFormValues>();
  const tie = useWatch({ control, name: `ties.${index}` });
  const itemErrors = errors.ties?.[index];
  const preview = tie?.previewUrl;

  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <VStack gap="x4" alignItems="stretch">
        <HStack justify="space-between" gap="x3">
          <Checkbox
            checked={selected}
            onChange={(event) => onSelectedChange(event.currentTarget.checked)}
            label={`넥타이 ${index + 1}`}
          />
          <HStack gap="x3">
            <Text textStyle="label">{cost.toLocaleString()}원</Text>
            <ActionButton
              type="button"
              variant="ghost"
              size="small"
              onClick={onRemove}
            >
              삭제
            </ActionButton>
          </HStack>
        </HStack>

        <Flex direction={{ base: "column", md: "row" }} gap="x4">
          <VStack gap="x2" alignItems="flex-start">
            <Box position="relative">
              <AttachmentDisplayField
                max={1}
                accept={REFORM_IMAGE_ACCEPT}
                addLabel="넥타이 사진 추가 (필수)"
                errorMessage={itemErrors?.file?.message}
                items={
                  preview
                    ? [
                        {
                          id: tie.itemId,
                          src: preview,
                          alt: `넥타이 ${index + 1}`,
                        },
                      ]
                    : []
                }
                onAddFiles={(files) => {
                  const file = files[0] ?? null;
                  if (tie?.previewUrl?.startsWith("blob:"))
                    URL.revokeObjectURL(tie.previewUrl);
                  setValue(`ties.${index}.file`, file, { shouldDirty: true });
                  setValue(
                    `ties.${index}.previewUrl`,
                    file ? URL.createObjectURL(file) : null,
                  );
                  setValue(`ties.${index}.uploadedImage`, null);
                  clearErrors(`ties.${index}.file`);
                }}
                onRemove={() => {
                  if (preview?.startsWith("blob:"))
                    URL.revokeObjectURL(preview);
                  setValue(`ties.${index}.file`, null, { shouldDirty: true });
                  setValue(`ties.${index}.previewUrl`, null);
                  setValue(`ties.${index}.uploadedImage`, null);
                }}
              />
              {/* 사진 필수 표시 — 라벨 대신 추가 타일 우측 상단에 * */}
              {!preview && !tie?.uploadedImage ? (
                <Float
                  placement="top-end"
                  offsetX="x1_5"
                  offsetY="x1"
                  aria-hidden
                  className="pointer-events-none"
                >
                  <Text textStyle="label" color="fg.critical">
                    *
                  </Text>
                </Float>
              ) : null}
            </Box>
            {!preview && tie?.uploadedImage ? (
              <Text textStyle="caption" color="fg.positive">
                등록된 사진을 사용합니다.
              </Text>
            ) : null}
          </VStack>

          <Box flex={1} minWidth={0}>
            {/* 사진 컬럼과 같은 Field 라벨 체계 — 두 컬럼의 라벨·콘텐츠 기준선을 맞춘다 */}
            <Field label="수선 옵션">
              <VStack gap="x3" alignItems="flex-start">
                <VStack gap="x1" alignItems="stretch">
                  {serviceLines(tie).map((line) => (
                    <Text key={line} textStyle="bodySm" color="fg.neutral">
                      {line}
                    </Text>
                  ))}
                </VStack>
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  size="small"
                  onClick={onEditOptions}
                >
                  옵션 수정
                </ActionButton>
              </VStack>
            </Field>
          </Box>
        </Flex>
      </VStack>
    </Box>
  );
}

/** 폼 값 기준 수선 옵션 요약 — 표기 형식은 model/reform.ts의 reformServiceLabel과 동일 */
function serviceLines(tie: ReformTieForm | undefined): string[] {
  if (!tie) return [];
  const lines: string[] = [];
  if (tie.automaticEnabled) {
    const details = [
      tie.mechanism === "zipper"
        ? "지퍼"
        : tie.mechanism === "string"
          ? "끈"
          : null,
      tie.wearerHeightCm != null ? `착용자 ${tie.wearerHeightCm}cm` : null,
      tie.dimple ? "딤플" : null,
      tie.turnKnot ? "돌려묶기" : null,
    ].filter((value): value is string => value != null);
    lines.push(
      details.length ? `자동 수선(${details.join(" · ")})` : "자동 수선",
    );
  }
  if (tie.widthEnabled) {
    lines.push(
      tie.targetWidthCm != null
        ? `폭 수선(희망 ${tie.targetWidthCm}cm)`
        : "폭 수선",
    );
  }
  if (tie.restorationEnabled) {
    const memo = tie.restorationMemo.trim();
    lines.push(memo ? `복원 수선(${memo})` : "복원 수선");
  }
  return lines;
}
