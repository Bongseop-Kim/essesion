import type { CouponCreateRequest } from "@essesion/api-client";
import {
  ActionButton,
  AlertDialog,
  Callout,
  Grid,
  HStack,
  RadioGroup,
  RadioGroupItem,
  Switch,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";

export type CouponDraft = {
  name: string;
  displayName: string;
  discountType: "percentage" | "fixed";
  discountValue: string;
  maxDiscountAmount: string;
  expiryDate: string;
  description: string;
  additionalInfo: string;
  isActive: boolean;
};

export const emptyCouponDraft: CouponDraft = {
  name: "",
  displayName: "",
  discountType: "percentage",
  discountValue: "",
  maxDiscountAmount: "",
  expiryDate: "",
  description: "",
  additionalInfo: "",
  isActive: true,
};

type CouponDraftErrors = Partial<Record<keyof CouponDraft, string>>;

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function positiveInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : undefined;
}

function validateDraft(draft: CouponDraft): CouponDraftErrors {
  const errors: CouponDraftErrors = {};
  const discountValue = positiveInteger(draft.discountValue);
  const maxDiscountAmount =
    draft.maxDiscountAmount === ""
      ? undefined
      : positiveInteger(draft.maxDiscountAmount);

  if (draft.name.trim() === "") errors.name = "쿠폰 이름을 입력해 주세요.";
  if (discountValue === undefined) {
    errors.discountValue = "0보다 큰 정수를 입력해 주세요.";
  } else if (draft.discountType === "percentage" && discountValue > 100) {
    errors.discountValue = "할인율은 1에서 100 사이여야 합니다.";
  }
  if (
    draft.discountType === "percentage" &&
    draft.maxDiscountAmount !== "" &&
    maxDiscountAmount === undefined
  ) {
    errors.maxDiscountAmount = "0보다 큰 정수를 입력해 주세요.";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiryDate)) {
    errors.expiryDate = "만료일을 입력해 주세요.";
  }
  return errors;
}

export function couponDraftBody(draft: CouponDraft): CouponCreateRequest {
  return {
    name: draft.name.trim(),
    display_name: optionalText(draft.displayName),
    discount_type: draft.discountType,
    discount_value: Number(draft.discountValue),
    max_discount_amount:
      draft.discountType === "percentage" && draft.maxDiscountAmount !== ""
        ? Number(draft.maxDiscountAmount)
        : null,
    expiry_date: draft.expiryDate,
    description: optionalText(draft.description),
    additional_info: optionalText(draft.additionalInfo),
    is_active: draft.isActive,
  };
}

export type CouponDefinitionFormProps = {
  initial: CouponDraft;
  revision?: string;
  resetSignal: number;
  submitLabel: string;
  pending: boolean;
  error?: unknown;
  errorAction?: ReactNode;
  onSubmit: (draft: CouponDraft, revision?: string) => void;
};

export function CouponDefinitionForm({
  initial,
  revision,
  resetSignal,
  submitLabel,
  pending,
  error,
  errorAction,
  onSubmit,
}: CouponDefinitionFormProps) {
  const [draft, setDraft] = useState(initial);
  const [baseDraft, setBaseDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [attempted, setAttempted] = useState(false);
  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);
  const appliedReset = useRef(resetSignal);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = useMemo(() => validateDraft(draft), [draft]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseDraft),
    [baseDraft, draft],
  );
  const blocker = useDirtyFormBlocker(dirty);

  useEffect(() => {
    if (invalidSubmitCount === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>("[aria-invalid='true']")
      ?.focus({ preventScroll: true });
  }, [invalidSubmitCount]);

  useEffect(() => {
    if (appliedReset.current === resetSignal) return;
    appliedReset.current = resetSignal;
    setDraft(initial);
    setBaseDraft(initial);
    setBaseRevision(revision);
    setAttempted(false);
    setInvalidSubmitCount(0);
  }, [initial, resetSignal, revision]);

  const update = <Key extends keyof CouponDraft>(
    key: Key,
    value: CouponDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (Object.keys(errors).length > 0) {
      setInvalidSubmitCount((current) => current + 1);
      return;
    }
    if (pending) return;
    onSubmit(draft, baseRevision);
  };

  return (
    <>
      <AdminCard
        title="쿠폰 정의"
        description="저장된 조건은 이후 발급 건부터 적용됩니다."
      >
        <VStack
          as="form"
          ref={formRef}
          gap="x5"
          alignItems="stretch"
          noValidate
          onSubmit={submit}
        >
          {attempted && Object.keys(errors).length > 0 && (
            <Callout
              role="alert"
              tone="critical"
              title="입력한 쿠폰 조건을 확인해 주세요"
            />
          )}
          <Grid columns={{ base: 1, md: 2 }} gap="x4">
            <TextField
              label="관리용 쿠폰 이름"
              required
              maxLength={100}
              value={draft.name}
              errorMessage={attempted ? errors.name : undefined}
              disabled={pending}
              onChange={(event) => update("name", event.currentTarget.value)}
            />
            <TextField
              label="고객 표시 이름"
              maxLength={100}
              value={draft.displayName}
              disabled={pending}
              onChange={(event) =>
                update("displayName", event.currentTarget.value)
              }
            />
          </Grid>

          <VStack gap="x2" alignItems="stretch">
            <Text as="h3" textStyle="labelSm">
              할인 방식
            </Text>
            <RadioGroup
              aria-label="할인 방식"
              orientation="horizontal"
              value={draft.discountType}
              disabled={pending}
              onValueChange={(value) => {
                const discountType = value === "fixed" ? "fixed" : "percentage";
                setDraft((current) => ({
                  ...current,
                  discountType,
                  maxDiscountAmount:
                    discountType === "fixed" ? "" : current.maxDiscountAmount,
                }));
              }}
            >
              <RadioGroupItem value="percentage" label="정률 할인" />
              <RadioGroupItem value="fixed" label="정액 할인" />
            </RadioGroup>
          </VStack>

          <Grid columns={{ base: 1, md: 2 }} gap="x4">
            <TextField
              type="number"
              min={1}
              max={draft.discountType === "percentage" ? 100 : undefined}
              step={1}
              label={
                draft.discountType === "percentage" ? "할인율" : "할인 금액"
              }
              suffix={draft.discountType === "percentage" ? "%" : "원"}
              required
              value={draft.discountValue}
              errorMessage={attempted ? errors.discountValue : undefined}
              disabled={pending}
              onChange={(event) =>
                update("discountValue", event.currentTarget.value)
              }
            />
            {draft.discountType === "percentage" ? (
              <TextField
                type="number"
                min={1}
                step={1}
                label="최대 할인액"
                description="비워 두면 최대 할인액 제한이 없습니다."
                suffix="원"
                value={draft.maxDiscountAmount}
                errorMessage={attempted ? errors.maxDiscountAmount : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("maxDiscountAmount", event.currentTarget.value)
                }
              />
            ) : (
              <TextField
                type="date"
                label="만료일 (KST)"
                required
                value={draft.expiryDate}
                errorMessage={attempted ? errors.expiryDate : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("expiryDate", event.currentTarget.value)
                }
              />
            )}
          </Grid>

          {draft.discountType === "percentage" && (
            <TextField
              type="date"
              label="만료일 (KST)"
              required
              value={draft.expiryDate}
              errorMessage={attempted ? errors.expiryDate : undefined}
              disabled={pending}
              onChange={(event) =>
                update("expiryDate", event.currentTarget.value)
              }
            />
          )}

          <Grid columns={{ base: 1, md: 2 }} gap="x4">
            <TextAreaField
              label="쿠폰 설명"
              rows={4}
              maxLength={1000}
              value={draft.description}
              disabled={pending}
              onChange={(event) =>
                update("description", event.currentTarget.value)
              }
            />
            <TextAreaField
              label="추가 안내"
              rows={4}
              maxLength={1000}
              value={draft.additionalInfo}
              disabled={pending}
              onChange={(event) =>
                update("additionalInfo", event.currentTarget.value)
              }
            />
          </Grid>

          <Switch
            label="발급 가능한 활성 쿠폰"
            checked={draft.isActive}
            disabled={pending}
            onChange={(event) =>
              update("isActive", event.currentTarget.checked)
            }
          />

          {error != null && (
            <VStack gap="x3" alignItems="stretch">
              <Callout
                role="alert"
                tone="critical"
                title="쿠폰을 저장하지 못했습니다"
                description={getErrorMessage(
                  error,
                  "다른 관리자의 수정 또는 입력 조건을 확인해 주세요. 입력 내용은 보존됩니다.",
                )}
              />
              {errorAction}
            </VStack>
          )}

          <HStack gap="x2" wrap>
            <ActionButton type="submit" loading={pending}>
              {submitLabel}
            </ActionButton>
            <ActionButton
              variant="ghost"
              disabled={!dirty || pending}
              onClick={() => {
                setDraft(baseDraft);
                setAttempted(false);
              }}
            >
              변경 취소
            </ActionButton>
          </HStack>
        </VStack>
      </AdminCard>

      <AlertDialog
        open={blocker.state === "blocked"}
        title="저장하지 않은 쿠폰 변경을 버릴까요?"
        description="입력한 쿠폰 조건이 사라집니다."
        primaryActionProps={{
          children: "변경 버리기",
          variant: "criticalSolid",
          onClick: () => blocker.proceed?.(),
        }}
        secondaryActionProps={{
          children: "계속 편집",
          onClick: () => blocker.reset?.(),
        }}
      />
    </>
  );
}
