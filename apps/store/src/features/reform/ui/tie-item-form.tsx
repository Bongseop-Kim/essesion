import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Checkbox,
  Field,
  Flex,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";
import { Controller, useFormContext, useWatch } from "react-hook-form";
import { REFORM_IMAGE_ACCEPT } from "../api/upload";
import type { ReformFormValues } from "../model/reform";
import {
  AutomaticAddonSelector,
  ServiceTypeSelector,
} from "./service-controls";

export function TieItemForm({
  index,
  selected,
  cost,
  onSelectedChange,
  onRemove,
}: {
  index: number;
  selected: boolean;
  cost: number;
  onSelectedChange: (selected: boolean) => void;
  onRemove: () => void;
}) {
  const {
    control,
    clearErrors,
    register,
    setValue,
    formState: { errors },
  } = useFormContext<ReformFormValues>();
  const tie = useWatch({ control, name: `ties.${index}` });
  const itemErrors = errors.ties?.[index];
  const preview = tie?.previewUrl;

  const setServiceEnabled = (
    service: "automatic" | "width" | "restoration",
    enabled: boolean,
  ) => {
    const field =
      service === "automatic"
        ? "automaticEnabled"
        : service === "width"
          ? "widthEnabled"
          : "restorationEnabled";
    setValue(`ties.${index}.${field}`, enabled, { shouldDirty: true });
    if (service === "automatic" && enabled && !tie?.mechanism) {
      setValue(`ties.${index}.mechanism`, "zipper", { shouldDirty: true });
    }
    clearErrors(`ties.${index}.automaticEnabled`);
  };

  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <VStack gap="x5" alignItems="stretch">
        <HStack justify="space-between" gap="x3" align="flex-start">
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

        <Flex direction={{ base: "column", md: "row" }} gap="x5">
          <VStack gap="x3" alignItems="stretch">
            <AttachmentDisplayField
              label="넥타이 사진 (필수)"
              max={1}
              size={104}
              accept={REFORM_IMAGE_ACCEPT}
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
                if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
                setValue(`ties.${index}.file`, null, { shouldDirty: true });
                setValue(`ties.${index}.previewUrl`, null);
                setValue(`ties.${index}.uploadedImage`, null);
              }}
            />
            {!preview && tie?.uploadedImage ? (
              <Text textStyle="caption" color="fg.positive">
                등록된 사진을 사용합니다.
              </Text>
            ) : null}
          </VStack>

          <VStack gap="x4" alignItems="stretch" flex={1} minWidth={0}>
            <Field
              label="수선 종류"
              required
              errorMessage={itemErrors?.automaticEnabled?.message}
            >
              <ServiceTypeSelector
                values={{
                  automatic: tie?.automaticEnabled ?? false,
                  width: tie?.widthEnabled ?? false,
                  restoration: tie?.restorationEnabled ?? false,
                }}
                onChange={setServiceEnabled}
              />
            </Field>

            {tie?.automaticEnabled ? (
              <ServiceDetail>
                <Field
                  label="자동 수선 방식"
                  required
                  errorMessage={itemErrors?.mechanism?.message}
                >
                  <Controller
                    control={control}
                    name={`ties.${index}.mechanism`}
                    render={({ field }) => (
                      <RadioGroup
                        orientation="horizontal"
                        value={field.value}
                        onValueChange={(value) => {
                          field.onChange(value);
                          if (value === "string") {
                            setValue(`ties.${index}.turnKnot`, false);
                          }
                        }}
                      >
                        <RadioGroupItem value="zipper" label="지퍼" />
                        <RadioGroupItem value="string" label="끈" />
                      </RadioGroup>
                    )}
                  />
                </Field>
                <TextField
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  label="착용자 키"
                  suffix="cm"
                  placeholder="170"
                  required
                  errorMessage={itemErrors?.wearerHeightCm?.message}
                  {...register(`ties.${index}.wearerHeightCm`, {
                    valueAsNumber: true,
                  })}
                />
                <Field label="추가 옵션">
                  <AutomaticAddonSelector
                    dimple={tie.dimple}
                    turnKnot={tie.turnKnot}
                    showTurnKnot={tie.mechanism === "zipper"}
                    onDimpleChange={(selected) =>
                      setValue(`ties.${index}.dimple`, selected, {
                        shouldDirty: true,
                      })
                    }
                    onTurnKnotChange={(selected) =>
                      setValue(`ties.${index}.turnKnot`, selected, {
                        shouldDirty: true,
                      })
                    }
                  />
                </Field>
              </ServiceDetail>
            ) : null}

            {tie?.widthEnabled ? (
              <ServiceDetail>
                <TextField
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  label="희망 폭"
                  suffix="cm"
                  placeholder="7.5"
                  required
                  errorMessage={itemErrors?.targetWidthCm?.message}
                  {...register(`ties.${index}.targetWidthCm`, {
                    valueAsNumber: true,
                  })}
                />
              </ServiceDetail>
            ) : null}

            {tie?.restorationEnabled ? (
              <ServiceDetail>
                <TextAreaField
                  label="복원 요청 메모"
                  maxLength={200}
                  rows={3}
                  errorMessage={itemErrors?.restorationMemo?.message}
                  {...register(`ties.${index}.restorationMemo`)}
                />
              </ServiceDetail>
            ) : null}
          </VStack>
        </Flex>
      </VStack>
    </Box>
  );
}

/** 선택한 수선 종류에 종속된 상세 입력 — 왼쪽 보더 들여쓰기로 위계 표시 */
function ServiceDetail({ children }: { children: ReactNode }) {
  return (
    <Box pl="x4" className="border-l-2 border-stroke-neutral-weak">
      <VStack gap="x3" alignItems="stretch">
        {children}
      </VStack>
    </Box>
  );
}
