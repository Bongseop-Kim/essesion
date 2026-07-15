import type {
  ManualOrderCreateRequest,
  ManualOrderItem,
  ManualOrderOut,
} from "@essesion/api-client";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  Checkbox,
  Grid,
  HStack,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  TextAreaField,
  TextField,
  VStack,
} from "@essesion/shared";
import {
  type FormEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getErrorMessage } from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";
import { DatePicker } from "../../shared/ui/date-picker";

type ItemDraft = {
  quantity: string;
  hasAutomatic: boolean;
  mechanism: "zipper" | "string";
  turnKnot: boolean;
  dimple: boolean;
  totalLengthCm: string;
  hasWidth: boolean;
  targetWidthCm: string;
  hasRestoration: boolean;
  restorationMemo: string;
  note: string;
};

export type ManualOrderDraft = {
  orderDate: string;
  customerName: string;
  phone: string;
  address: string;
  amount: string;
  shippingFee: string;
  isReceived: boolean;
  isPaid: boolean;
  isConfirmed: boolean;
  items: ItemDraft[];
};

const emptyItemDraft: ItemDraft = {
  quantity: "1",
  hasAutomatic: false,
  mechanism: "zipper",
  turnKnot: false,
  dimple: false,
  totalLengthCm: "",
  hasWidth: false,
  targetWidthCm: "",
  hasRestoration: false,
  restorationMemo: "",
  note: "",
};

export const emptyManualOrderDraft: ManualOrderDraft = {
  orderDate: "",
  customerName: "",
  phone: "",
  address: "",
  amount: "",
  shippingFee: "0",
  isReceived: false,
  isPaid: false,
  isConfirmed: false,
  items: [emptyItemDraft],
};

export function manualOrderDraftFrom(order: ManualOrderOut): ManualOrderDraft {
  return {
    orderDate: order.order_date,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address ?? "",
    amount: String(order.amount),
    shippingFee: String(order.shipping_fee),
    isReceived: order.is_received,
    isPaid: order.is_paid,
    isConfirmed: order.is_confirmed,
    items: order.items.map((item) => ({
      quantity: String(item.quantity),
      hasAutomatic: item.automatic != null,
      mechanism: item.automatic?.mechanism ?? "zipper",
      turnKnot: item.automatic?.turn_knot ?? false,
      dimple: item.automatic?.dimple ?? false,
      totalLengthCm:
        item.automatic == null ? "" : String(item.automatic.total_length_cm),
      hasWidth: item.width != null,
      targetWidthCm:
        item.width == null ? "" : String(item.width.target_width_cm),
      hasRestoration: item.restoration != null,
      restorationMemo: item.restoration?.memo ?? "",
      note: item.note ?? "",
    })),
  };
}

type ItemErrors = Partial<
  Record<"quantity" | "category" | "totalLengthCm" | "targetWidthCm", string>
>;
type DraftErrors = Partial<
  Record<
    "orderDate" | "customerName" | "phone" | "amount" | "shippingFee" | "items",
    string
  >
> & { itemErrors: ItemErrors[] };

function optionalText(value: string) {
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function nonNegativeInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) ? numeric : undefined;
}

function positiveNumber(value: string) {
  const numeric = Number(value);
  return value.trim() !== "" && Number.isFinite(numeric) && numeric > 0
    ? numeric
    : undefined;
}

function validateItem(item: ItemDraft): ItemErrors {
  const errors: ItemErrors = {};
  const quantity = nonNegativeInteger(item.quantity);
  if (quantity === undefined || quantity < 1) {
    errors.quantity = "1 이상의 정수를 입력해 주세요.";
  }
  if (!item.hasAutomatic && !item.hasWidth && !item.hasRestoration) {
    errors.category = "수선 대분류를 하나 이상 선택해 주세요.";
  }
  if (item.hasAutomatic && positiveNumber(item.totalLengthCm) === undefined) {
    errors.totalLengthCm = "0보다 큰 총장(cm)을 입력해 주세요.";
  }
  if (item.hasWidth && positiveNumber(item.targetWidthCm) === undefined) {
    errors.targetWidthCm = "0보다 큰 폭(cm)을 입력해 주세요.";
  }
  return errors;
}

function validateDraft(draft: ManualOrderDraft): DraftErrors {
  const errors: DraftErrors = { itemErrors: draft.items.map(validateItem) };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.orderDate)) {
    errors.orderDate = "날짜를 선택해 주세요.";
  }
  if (draft.customerName.trim() === "") {
    errors.customerName = "이름을 입력해 주세요.";
  }
  if (draft.phone.trim() === "") errors.phone = "휴대폰 번호를 입력해 주세요.";
  if (nonNegativeInteger(draft.amount) === undefined) {
    errors.amount = "0 이상의 정수를 입력해 주세요.";
  }
  if (nonNegativeInteger(draft.shippingFee) === undefined) {
    errors.shippingFee = "0 이상의 정수를 입력해 주세요.";
  }
  if (draft.items.length === 0) errors.items = "품목을 1개 이상 추가해 주세요.";
  return errors;
}

function hasErrors(errors: DraftErrors) {
  const { itemErrors, ...fields } = errors;
  return (
    Object.keys(fields).length > 0 ||
    itemErrors.some((item) => Object.keys(item).length > 0)
  );
}

function itemBody(item: ItemDraft): ManualOrderItem {
  return {
    quantity: Number(item.quantity),
    automatic: item.hasAutomatic
      ? {
          mechanism: item.mechanism,
          turn_knot: item.turnKnot,
          dimple: item.dimple,
          total_length_cm: Number(item.totalLengthCm),
        }
      : null,
    width: item.hasWidth
      ? { target_width_cm: Number(item.targetWidthCm) }
      : null,
    restoration: item.hasRestoration
      ? { memo: item.restorationMemo.trim() }
      : null,
    note: item.note.trim(),
  };
}

export function manualOrderDraftBody(
  draft: ManualOrderDraft,
): ManualOrderCreateRequest {
  return {
    order_date: draft.orderDate,
    customer_name: draft.customerName.trim(),
    phone: draft.phone.trim(),
    address: optionalText(draft.address),
    amount: Number(draft.amount),
    shipping_fee: Number(draft.shippingFee),
    is_received: draft.isReceived,
    is_paid: draft.isPaid,
    is_confirmed: draft.isConfirmed,
    items: draft.items.map(itemBody),
  };
}

export type ManualOrderFormProps = {
  initial: ManualOrderDraft;
  revision?: string;
  resetSignal: number;
  submitLabel: string;
  pending: boolean;
  error?: unknown;
  errorAction?: ReactNode;
  // 저장 성공 후 navigate() 직전 부모가 true로 설정해 이탈 차단을 건너뛴다.
  blockerBypassRef?: RefObject<boolean>;
  onSubmit: (draft: ManualOrderDraft, revision?: string) => void;
};

export function ManualOrderForm({
  initial,
  revision,
  resetSignal,
  submitLabel,
  pending,
  error,
  errorAction,
  blockerBypassRef,
  onSubmit,
}: ManualOrderFormProps) {
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
  const blocker = useDirtyFormBlocker(dirty, blockerBypassRef);

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

  const update = <Key extends keyof ManualOrderDraft>(
    key: Key,
    value: ManualOrderDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const updateItem = (index: number, changes: Partial<ItemDraft>) =>
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, position) =>
        position === index ? { ...item, ...changes } : item,
      ),
    }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (hasErrors(errors)) {
      setInvalidSubmitCount((current) => current + 1);
      return;
    }
    if (pending) return;
    onSubmit(draft, baseRevision);
  };

  return (
    <>
      <VStack
        as="form"
        ref={formRef}
        gap="x6"
        alignItems="stretch"
        noValidate
        onSubmit={submit}
      >
        {attempted && hasErrors(errors) && (
          <Callout
            role="alert"
            tone="critical"
            title="입력한 주문 내용을 확인해 주세요"
          />
        )}

        <AdminCard
          title="주문 정보"
          description="작업지시서의 고객·금액 정보를 입력합니다."
        >
          <VStack gap="x5" alignItems="stretch">
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <DatePicker
                label="날짜"
                required
                value={draft.orderDate}
                errorMessage={attempted ? errors.orderDate : undefined}
                disabled={pending}
                onValueChange={(value) => update("orderDate", value)}
              />
              <TextField
                label="이름"
                required
                maxLength={100}
                value={draft.customerName}
                errorMessage={attempted ? errors.customerName : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("customerName", event.currentTarget.value)
                }
              />
              <TextField
                label="휴대폰"
                required
                maxLength={20}
                value={draft.phone}
                errorMessage={attempted ? errors.phone : undefined}
                disabled={pending}
                onChange={(event) => update("phone", event.currentTarget.value)}
              />
              <TextField
                label="주소"
                maxLength={500}
                value={draft.address}
                disabled={pending}
                onChange={(event) =>
                  update("address", event.currentTarget.value)
                }
              />
              <TextField
                type="number"
                min={0}
                step={1}
                label="금액"
                suffix="원"
                required
                value={draft.amount}
                errorMessage={attempted ? errors.amount : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("amount", event.currentTarget.value)
                }
              />
              <TextField
                type="number"
                min={0}
                step={1}
                label="택배비"
                suffix="원"
                value={draft.shippingFee}
                errorMessage={attempted ? errors.shippingFee : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("shippingFee", event.currentTarget.value)
                }
              />
            </Grid>

            <VStack gap="x2" alignItems="stretch">
              <Text as="h3" textStyle="labelSm">
                진행 상태
              </Text>
              <HStack gap="x5" wrap>
                <Checkbox
                  label="접수"
                  checked={draft.isReceived}
                  disabled={pending}
                  onChange={(event) =>
                    update("isReceived", event.currentTarget.checked)
                  }
                />
                <Checkbox
                  label="결제"
                  checked={draft.isPaid}
                  disabled={pending}
                  onChange={(event) =>
                    update("isPaid", event.currentTarget.checked)
                  }
                />
                <Checkbox
                  label="확인"
                  checked={draft.isConfirmed}
                  disabled={pending}
                  onChange={(event) =>
                    update("isConfirmed", event.currentTarget.checked)
                  }
                />
              </HStack>
            </VStack>
          </VStack>
        </AdminCard>

        <AdminCard
          title="수선 품목"
          description="품목마다 대분류를 하나 이상 선택합니다. 끈 타입은 돌려묶기를 선택할 수 없습니다."
        >
          <VStack gap="x4" alignItems="stretch">
            {attempted && errors.items !== undefined && (
              <Callout role="alert" tone="critical" title={errors.items} />
            )}
            {draft.items.map((item, index) => {
              const itemErrors = attempted
                ? (errors.itemErrors[index] ?? {})
                : {};
              return (
                <Box
                  key={index}
                  borderWidth={1}
                  borderColor="stroke.neutral"
                  borderRadius="r2"
                  p="x4"
                >
                  <VStack gap="x4" alignItems="stretch">
                    <HStack justify="space-between" align="center" gap="x4">
                      <Text as="h3" textStyle="labelSm">
                        품목 {index + 1}
                      </Text>
                      <ActionButton
                        variant="ghost"
                        size="small"
                        disabled={pending}
                        onClick={() =>
                          setDraft((current) => ({
                            ...current,
                            items: current.items.filter(
                              (_, position) => position !== index,
                            ),
                          }))
                        }
                      >
                        삭제
                      </ActionButton>
                    </HStack>

                    <Grid columns={{ base: 1, md: 2 }} gap="x4">
                      <TextField
                        type="number"
                        min={1}
                        step={1}
                        label="수량"
                        suffix="개"
                        required
                        value={item.quantity}
                        errorMessage={itemErrors.quantity}
                        disabled={pending}
                        onChange={(event) =>
                          updateItem(index, {
                            quantity: event.currentTarget.value,
                          })
                        }
                      />
                      <VStack gap="x2" alignItems="stretch">
                        <Text as="h4" textStyle="labelSm">
                          대분류
                        </Text>
                        <HStack gap="x4" wrap>
                          <Checkbox
                            label="자동수선"
                            checked={item.hasAutomatic}
                            disabled={pending}
                            onChange={(event) =>
                              updateItem(index, {
                                hasAutomatic: event.currentTarget.checked,
                              })
                            }
                          />
                          <Checkbox
                            label="폭수선"
                            checked={item.hasWidth}
                            disabled={pending}
                            onChange={(event) =>
                              updateItem(index, {
                                hasWidth: event.currentTarget.checked,
                              })
                            }
                          />
                          <Checkbox
                            label="복원수선"
                            checked={item.hasRestoration}
                            disabled={pending}
                            onChange={(event) =>
                              updateItem(index, {
                                hasRestoration: event.currentTarget.checked,
                              })
                            }
                          />
                        </HStack>
                        {itemErrors.category !== undefined && (
                          <Text textStyle="caption" color="fg.critical">
                            {itemErrors.category}
                          </Text>
                        )}
                      </VStack>
                    </Grid>

                    {item.hasAutomatic && (
                      <Grid columns={{ base: 1, md: 2 }} gap="x4">
                        <VStack gap="x2" alignItems="stretch">
                          <Text as="h4" textStyle="labelSm">
                            [자동] 타입
                          </Text>
                          <SegmentedControl
                            aria-label="자동수선 타입"
                            value={item.mechanism}
                            onValueChange={(value) =>
                              updateItem(
                                index,
                                value === "string"
                                  ? { mechanism: "string", turnKnot: false }
                                  : { mechanism: "zipper" },
                              )
                            }
                          >
                            <SegmentedControlItem value="zipper">
                              지퍼
                            </SegmentedControlItem>
                            <SegmentedControlItem value="string">
                              끈
                            </SegmentedControlItem>
                          </SegmentedControl>
                        </VStack>
                        <VStack gap="x2" alignItems="stretch">
                          <Text as="h4" textStyle="labelSm">
                            [자동] 마감
                          </Text>
                          <SegmentedControl
                            aria-label="자동수선 마감"
                            value={item.turnKnot ? "turnKnot" : "bang"}
                            onValueChange={(value) =>
                              updateItem(index, {
                                turnKnot: value === "turnKnot",
                              })
                            }
                          >
                            <SegmentedControlItem value="bang">
                              방
                            </SegmentedControlItem>
                            <SegmentedControlItem
                              value="turnKnot"
                              disabled={item.mechanism === "string"}
                            >
                              돌려묶기
                            </SegmentedControlItem>
                          </SegmentedControl>
                        </VStack>
                        <VStack gap="x2" alignItems="stretch">
                          <Text as="h4" textStyle="labelSm">
                            [자동] 딤플
                          </Text>
                          <SegmentedControl
                            aria-label="자동수선 딤플"
                            value={item.dimple ? "dimple" : "basic"}
                            onValueChange={(value) =>
                              updateItem(index, { dimple: value === "dimple" })
                            }
                          >
                            <SegmentedControlItem value="basic">
                              기본
                            </SegmentedControlItem>
                            <SegmentedControlItem value="dimple">
                              딤플
                            </SegmentedControlItem>
                          </SegmentedControl>
                        </VStack>
                        <TextField
                          type="number"
                          min={1}
                          label="[자동] 총장"
                          suffix="cm"
                          required
                          value={item.totalLengthCm}
                          errorMessage={itemErrors.totalLengthCm}
                          disabled={pending}
                          onChange={(event) =>
                            updateItem(index, {
                              totalLengthCm: event.currentTarget.value,
                            })
                          }
                        />
                      </Grid>
                    )}

                    {item.hasWidth && (
                      <Grid columns={{ base: 1, md: 2 }} gap="x4">
                        <TextField
                          type="number"
                          min={1}
                          label="[폭] 폭"
                          suffix="cm"
                          required
                          value={item.targetWidthCm}
                          errorMessage={itemErrors.targetWidthCm}
                          disabled={pending}
                          onChange={(event) =>
                            updateItem(index, {
                              targetWidthCm: event.currentTarget.value,
                            })
                          }
                        />
                      </Grid>
                    )}

                    {item.hasRestoration && (
                      <TextAreaField
                        label="[복원] 내용"
                        rows={2}
                        maxLength={200}
                        value={item.restorationMemo}
                        disabled={pending}
                        onChange={(event) =>
                          updateItem(index, {
                            restorationMemo: event.currentTarget.value,
                          })
                        }
                      />
                    )}

                    <TextAreaField
                      label="특이사항"
                      rows={2}
                      maxLength={500}
                      value={item.note}
                      disabled={pending}
                      onChange={(event) =>
                        updateItem(index, { note: event.currentTarget.value })
                      }
                    />
                  </VStack>
                </Box>
              );
            })}
            <HStack>
              <ActionButton
                variant="neutralOutline"
                disabled={pending}
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    items: [...current.items, emptyItemDraft],
                  }))
                }
              >
                품목 추가
              </ActionButton>
            </HStack>
          </VStack>
        </AdminCard>

        {error != null && (
          <VStack gap="x3" alignItems="stretch">
            <Callout
              role="alert"
              tone="critical"
              title="수기 주문을 저장하지 못했습니다"
              description={getErrorMessage(
                error,
                "다른 관리자의 수정 또는 입력 내용을 확인해 주세요. 입력 내용은 보존됩니다.",
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

      <AlertDialog
        open={blocker.state === "blocked"}
        title="저장하지 않은 주문 변경을 버릴까요?"
        description="입력한 작업지시서 내용이 사라집니다."
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
