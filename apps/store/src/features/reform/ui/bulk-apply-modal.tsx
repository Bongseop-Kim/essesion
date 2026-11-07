import {
  ActionButton,
  Box,
  Checkbox,
  Field,
  HStack,
  Modal,
  RadioGroup,
  RadioGroupItem,
  recommendedTieLengthCm,
  SegmentedControl,
  SegmentedControlItem,
  Text,
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
  totalLengthCm: number | null;
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
  // 키 대신 넥타이 길이를 직접 받는 모드 — 저장된 길이가 있으면 길이 모드로 연다
  const [lengthMode, setLengthMode] = useState(
    initialValues.totalLengthCm != null,
  );

  useEffect(() => {
    if (!open) return;
    setValues(initialValues);
    setLengthMode(initialValues.totalLengthCm != null);
    setError(null);
  }, [initialValues, open]);

  // 한쪽만 저장되도록 모드를 바꾸면 반대쪽 값은 비운다
  const switchLengthMode = () => {
    setLengthMode(!lengthMode);
    setValues({ ...values, wearerHeightCm: null, totalLengthCm: null });
  };

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
      (values.mechanism === "" ||
        !isPositive(lengthMode ? values.totalLengthCm : values.wearerHeightCm))
    ) {
      setError(
        lengthMode
          ? "자동 수선 방식과 넥타이 길이를 확인해 주세요."
          : "자동 수선 방식과 착용자 키를 확인해 주세요.",
      );
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
    <Modal
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
                        dimple: mechanism === "zipper" && values.dimple,
                      })
                    }
                  >
                    <RadioGroupItem value="zipper" label="지퍼" />
                    <RadioGroupItem value="string" label="끈" />
                  </RadioGroup>
                </Field>
                <VStack gap="x1_5" alignItems="stretch">
                  {/* 입력칸(h-10)과 같은 높이(40px)의 세그먼트 토글로 입력 방식을 바꾼다 */}
                  <HStack gap="x2" align="flex-end">
                    <Box flex={1}>
                      <TextField
                        type="number"
                        step="0.1"
                        label={lengthMode ? "넥타이 길이" : "착용자 키"}
                        suffix="cm"
                        placeholder={lengthMode ? "49" : "170"}
                        required
                        value={
                          (lengthMode
                            ? values.totalLengthCm
                            : values.wearerHeightCm) ?? ""
                        }
                        onChange={(event) => {
                          const raw = event.currentTarget.value;
                          const value = raw === "" ? null : Number(raw);
                          setValues(
                            lengthMode
                              ? { ...values, totalLengthCm: value }
                              : { ...values, wearerHeightCm: value },
                          );
                        }}
                      />
                    </Box>
                    <SegmentedControl
                      aria-label="길이 입력 방식"
                      value={lengthMode ? "length" : "height"}
                      onValueChange={(mode) => {
                        if ((mode === "length") !== lengthMode)
                          switchLengthMode();
                      }}
                    >
                      <SegmentedControlItem value="height">
                        키
                      </SegmentedControlItem>
                      <SegmentedControlItem value="length">
                        길이
                      </SegmentedControlItem>
                    </SegmentedControl>
                  </HStack>
                  <Text textStyle="caption" color="fg.neutral-muted">
                    {lengthMode
                      ? "매듭 위 끝부터 대검 끝까지, 매듭을 포함한 길이예요."
                      : isPositive(values.wearerHeightCm)
                        ? `권장 넥타이 길이 ${recommendedTieLengthCm(values.wearerHeightCm)}cm (매듭 포함)`
                        : "키를 입력하면 권장 넥타이 길이로 맞춰 드려요."}
                  </Text>
                </VStack>
                <Field label="추가 옵션">
                  <AutomaticAddonSelector
                    mechanism={values.mechanism}
                    dimple={values.dimple}
                    turnKnot={values.turnKnot}
                    onDimpleChange={(dimple) =>
                      // 딤플은 돌려묶기 필수 — 켜면 같이 켠다(돌려묶기는 잠긴다)
                      setValues({
                        ...values,
                        dimple,
                        turnKnot: dimple || values.turnKnot,
                      })
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
    </Modal>
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

function isPositive(value: number | null): value is number {
  return value != null && Number.isFinite(value) && value > 0;
}
