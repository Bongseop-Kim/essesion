import {
  ActionButton,
  Box,
  Checkbox,
  Field,
  HStack,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import { type ReactNode, useEffect, useState } from "react";
import { AutomaticAddonSelector } from "./service-controls";

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

  const toggleService = (
    service: "automatic" | "width" | "restoration",
    selected: boolean,
  ) => {
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
  };

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
      {/* 서비스별 체크박스 + 체크 시 바로 아래 하위 필드가 펼쳐지는 부모-자식 구조.
          체크박스에 서비스별 가격을 표시하지 않는다 — 조합 가격이라 단독가 나열은 합산으로 오독됨. */}
      <Field label="수선 종류" required errorMessage={error}>
        <VStack gap="x4" alignItems="stretch">
          <VStack gap="x3" alignItems="stretch">
            <Checkbox
              label="자동 수선"
              checked={values.automaticEnabled}
              onChange={(event) =>
                toggleService("automatic", event.currentTarget.checked)
              }
            />
            {values.automaticEnabled ? (
              <ServiceDetail>
                <Field label="자동 수선 방식" required>
                  <RadioGroup
                    orientation="horizontal"
                    value={values.mechanism}
                    onValueChange={(mechanism) =>
                      setValues({
                        ...values,
                        mechanism:
                          mechanism as ReformSettingsValues["mechanism"],
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
                <Field label="추가 옵션">
                  <AutomaticAddonSelector
                    dimple={values.dimple}
                    turnKnot={values.turnKnot}
                    showTurnKnot={values.mechanism === "zipper"}
                    onDimpleChange={(dimple) =>
                      setValues({ ...values, dimple })
                    }
                    onTurnKnotChange={(turnKnot) =>
                      setValues({ ...values, turnKnot })
                    }
                  />
                </Field>
              </ServiceDetail>
            ) : null}
          </VStack>

          <VStack gap="x3" alignItems="stretch">
            <Checkbox
              label="폭 수선"
              checked={values.widthEnabled}
              onChange={(event) =>
                toggleService("width", event.currentTarget.checked)
              }
            />
            {values.widthEnabled ? (
              <ServiceDetail>
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
              </ServiceDetail>
            ) : null}
          </VStack>

          <VStack gap="x3" alignItems="stretch">
            <Checkbox
              label="복원 수선"
              checked={values.restorationEnabled}
              onChange={(event) =>
                toggleService("restoration", event.currentTarget.checked)
              }
            />
            {values.restorationEnabled ? (
              <ServiceDetail>
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
              </ServiceDetail>
            ) : null}
          </VStack>
        </VStack>
      </Field>
    </ResponsiveModal>
  );
}

/** 체크한 서비스에 종속된 상세 입력 — 왼쪽 보더 들여쓰기로 위계 표시 */
function ServiceDetail({ children }: { children: ReactNode }) {
  return (
    <Box pl="x4" className="border-l-2 border-stroke-neutral-weak">
      <VStack gap="x3" alignItems="stretch">
        {children}
      </VStack>
    </Box>
  );
}

function isPositive(value: number | null) {
  return value != null && Number.isFinite(value) && value > 0;
}
