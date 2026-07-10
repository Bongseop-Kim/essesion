import {
  ActionButton,
  Box,
  Field,
  HStack,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { useEffect, useState } from "react";
import {
  AutomaticAddonSelector,
  ServiceTypeSelector,
} from "./service-controls";

export type ReformSettingsValues = {
  automaticEnabled: boolean;
  mechanism: "" | "zipper" | "string";
  wearerHeightCm: number | null;
  dimple: boolean;
  turnKnot: boolean;
  widthEnabled: boolean;
  targetWidthCm: number | null;
  restorationEnabled: boolean;
  restorationMemo: string;
};

export type BulkValues = ReformSettingsValues;

const INITIAL_VALUES: ReformSettingsValues = {
  automaticEnabled: true,
  mechanism: "zipper",
  wearerHeightCm: null,
  dimple: false,
  turnKnot: false,
  widthEnabled: false,
  targetWidthCm: null,
  restorationEnabled: false,
  restorationMemo: "",
};

export function BulkApplyModal({
  open,
  selectedCount,
  onOpenChange,
  onApply,
}: {
  open: boolean;
  selectedCount: number;
  onOpenChange: (open: boolean) => void;
  onApply: (values: BulkValues) => void;
}) {
  return (
    <ReformSettingsModal
      open={open}
      onOpenChange={onOpenChange}
      title="일괄 적용"
      description={`선택한 ${selectedCount}개 항목의 수선 설정을 교체합니다.`}
      initialValues={INITIAL_VALUES}
      submitLabel="적용"
      onApply={onApply}
    />
  );
}

export function ReformSettingsModal({
  open,
  title,
  description,
  initialValues,
  submitLabel = "변경",
  onOpenChange,
  onApply,
}: {
  open: boolean;
  title: string;
  description?: string;
  initialValues: ReformSettingsValues;
  submitLabel?: string;
  onOpenChange: (open: boolean) => void;
  onApply: (values: ReformSettingsValues) => void | Promise<void>;
}) {
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setError(null);
  }, [initialValues, open]);

  const apply = async () => {
    if (
      !values.automaticEnabled &&
      !values.widthEnabled &&
      !values.restorationEnabled
    ) {
      setError("수선 서비스를 하나 이상 선택해 주세요.");
      return;
    }
    if (
      values.automaticEnabled &&
      (values.mechanism === "" || !isPositive(values.wearerHeightCm))
    ) {
      setError("자동 수선 방식과 착용자 키를 확인해 주세요.");
      return;
    }
    if (values.widthEnabled && !isPositive(values.targetWidthCm)) {
      setError("희망 폭을 입력해 주세요.");
      return;
    }
    setSaving(true);
    try {
      await onApply(values);
      onOpenChange(false);
    } catch {
      setError("수선 옵션을 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      showCloseButton
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            loading={saving}
            onClick={() => void apply()}
          >
            {submitLabel}
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        <Field label="수선 종류" required errorMessage={error}>
          <ServiceTypeSelector
            columns={1}
            values={{
              automatic: values.automaticEnabled,
              width: values.widthEnabled,
              restoration: values.restorationEnabled,
            }}
            onChange={(service, selected) => {
              setError(null);
              setValues((current) => ({
                ...current,
                ...(service === "automatic"
                  ? {
                      automaticEnabled: selected,
                      mechanism:
                        selected && current.mechanism === ""
                          ? ("zipper" as const)
                          : current.mechanism,
                    }
                  : service === "width"
                    ? { widthEnabled: selected }
                    : { restorationEnabled: selected }),
              }));
            }}
          />
        </Field>
        {values.automaticEnabled ? (
          <VStack gap="x3" alignItems="stretch">
            <Field label="자동 수선 방식" required>
              <RadioGroup
                orientation="horizontal"
                value={values.mechanism}
                onValueChange={(mechanism) =>
                  setValues({
                    ...values,
                    mechanism: mechanism as ReformSettingsValues["mechanism"],
                    turnKnot: mechanism === "zipper" && values.turnKnot,
                  })
                }
              >
                <RadioGroupItem value="zipper" label="지퍼" />
                <RadioGroupItem value="string" label="끈" />
              </RadioGroup>
            </Field>
            <TextField
              type="number"
              step="0.1"
              label="착용자 키"
              suffix="cm"
              placeholder="170"
              required
              value={values.wearerHeightCm ?? ""}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setValues({
                  ...values,
                  wearerHeightCm: value === "" ? null : Number(value),
                });
              }}
            />
            <AutomaticAddonSelector
              dimple={values.dimple}
              turnKnot={values.turnKnot}
              showTurnKnot={values.mechanism === "zipper"}
              onDimpleChange={(dimple) => setValues({ ...values, dimple })}
              onTurnKnotChange={(turnKnot) =>
                setValues({ ...values, turnKnot })
              }
            />
          </VStack>
        ) : null}
        {values.widthEnabled ? (
          <TextField
            type="number"
            step="0.1"
            label="희망 폭"
            suffix="cm"
            placeholder="7.5"
            required
            value={values.targetWidthCm ?? ""}
            onChange={(event) => {
              const value = event.currentTarget.value;
              setValues({
                ...values,
                targetWidthCm: value === "" ? null : Number(value),
              });
            }}
          />
        ) : null}
        {values.restorationEnabled ? (
          <TextAreaField
            label="복원 요청 메모"
            maxLength={200}
            rows={3}
            value={values.restorationMemo}
            onChange={(event) =>
              setValues({
                ...values,
                restorationMemo: event.currentTarget.value,
              })
            }
          />
        ) : null}
      </VStack>
    </ResponsiveModal>
  );
}

function isPositive(value: number | null) {
  return value != null && Number.isFinite(value) && value > 0;
}
