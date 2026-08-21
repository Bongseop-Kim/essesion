import {
  createManualOrderImageReadUrl,
  type ManualOrderCreateRequest,
  type ManualOrderItem,
  type ManualOrderOut,
} from "@essesion/api-client";
import {
  ActionButton,
  AlertDialog,
  AttachmentDisplayField,
  Box,
  Callout,
  Checkbox,
  canonicalizePhoneNumber,
  Grid,
  HStack,
  PhoneField,
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

import {
  formatDateTime,
  formatFileSize,
  formatMoney,
  getErrorMessage,
} from "../../shared/lib/format";
import { useDirtyFormBlocker } from "../../shared/lib/use-dirty-form-blocker";
import { AdminCard } from "../../shared/ui/admin-card";
import { NumberField } from "../../shared/ui/number-field";
import {
  MANUAL_ORDER_IMAGE_ACCEPT,
  MAX_MANUAL_ORDER_IMAGES,
  uploadManualOrderImage,
} from "./upload";

// 신규 업로드는 previewUrl(objectURL)을, 이미 저장된 이미지는 label만 가진다.
export type ImageDraft = { id: string; label: string; previewUrl?: string };

type ItemDraft = {
  clientId: string;
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
  // 주문제작 — automatic의 dimple/turnKnot와 구분하려고 custom* 접두
  hasCustom: boolean;
  fabricProvided: boolean;
  fabricType: "POLY" | "SILK";
  designType: "PRINTING" | "YARN_DYED";
  tieType: "MANUAL" | "AUTO";
  customDimple: boolean;
  customTurnKnot: boolean;
  sizeType: "ADULT" | "CHILD";
  tieWidthCm: string;
  customMemo: string;
  note: string;
  images: ImageDraft[];
};

export type ManualOrderDraft = {
  orderDate: string;
  customerName: string;
  phone: string;
  address: string;
  amount: string;
  discount: string;
  shippingFee: string;
  isReceived: boolean;
  isPaid: boolean;
  isConfirmed: boolean;
  items: ItemDraft[];
  images: ImageDraft[];
};

let nextItemDraftId = 0;

function createItemDraft(
  values: Partial<Omit<ItemDraft, "clientId">> = {},
): ItemDraft {
  nextItemDraftId += 1;
  return {
    clientId: `manual-order-item-${nextItemDraftId}`,
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
    hasCustom: false,
    fabricProvided: false,
    fabricType: "POLY",
    designType: "PRINTING",
    tieType: "MANUAL",
    customDimple: false,
    customTurnKnot: false,
    sizeType: "ADULT",
    tieWidthCm: "",
    customMemo: "",
    note: "",
    images: [],
    ...values,
  };
}

export const emptyManualOrderDraft: ManualOrderDraft = {
  orderDate: "",
  customerName: "",
  phone: "",
  address: "",
  amount: "",
  discount: "0",
  shippingFee: "0",
  isReceived: false,
  isPaid: false,
  isConfirmed: false,
  items: [createItemDraft()],
  images: [],
};

function imageDraftsFrom(
  order: ManualOrderOut,
  ids: readonly string[],
): ImageDraft[] {
  return order.images
    .filter((image) => ids.includes(image.id))
    .map((image) => ({
      id: image.id,
      label: `${image.content_type ?? "이미지"} · ${formatFileSize(image.size_bytes, "크기 미상")} · ${formatDateTime(image.created_at)}`,
    }));
}

export function manualOrderDraftFrom(order: ManualOrderOut): ManualOrderDraft {
  const itemImageIds = order.items.flatMap(
    (item) => item.image_upload_ids ?? [],
  );
  return {
    orderDate: order.order_date,
    customerName: order.customer_name,
    phone: order.phone,
    address: order.address ?? "",
    amount: String(order.amount),
    discount: String(order.discount),
    shippingFee: String(order.shipping_fee),
    isReceived: order.is_received,
    isPaid: order.is_paid,
    isConfirmed: order.is_confirmed,
    items: order.items.map((item) =>
      createItemDraft({
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
        hasCustom: item.custom != null,
        fabricProvided: item.custom?.fabric_provided ?? false,
        fabricType: item.custom?.fabric_type ?? "POLY",
        designType: item.custom?.design_type ?? "PRINTING",
        tieType: item.custom?.tie_type ?? "MANUAL",
        customDimple: item.custom?.dimple ?? false,
        customTurnKnot: item.custom?.turn_knot ?? false,
        sizeType: item.custom?.size_type ?? "ADULT",
        tieWidthCm:
          item.custom?.tie_width_cm == null
            ? ""
            : String(item.custom.tie_width_cm),
        customMemo: item.custom?.memo ?? "",
        note: item.note ?? "",
        images: imageDraftsFrom(order, item.image_upload_ids ?? []),
      }),
    ),
    // 주문 단위 첨부 = 어느 품목에도 속하지 않은 이미지
    images: imageDraftsFrom(
      order,
      order.images
        .map((image) => image.id)
        .filter((id) => !itemImageIds.includes(id)),
    ),
  };
}

type ItemErrors = Partial<
  Record<
    "quantity" | "category" | "totalLengthCm" | "targetWidthCm" | "tieWidthCm",
    string
  >
>;
type DraftErrors = Partial<
  Record<
    | "orderDate"
    | "customerName"
    | "phone"
    | "amount"
    | "discount"
    | "shippingFee"
    | "items",
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
  if (
    !item.hasAutomatic &&
    !item.hasWidth &&
    !item.hasRestoration &&
    !item.hasCustom
  ) {
    errors.category = "대분류를 하나 이상 선택해 주세요.";
  }
  if (item.hasAutomatic && positiveNumber(item.totalLengthCm) === undefined) {
    errors.totalLengthCm = "0보다 큰 총장(cm)을 입력해 주세요.";
  }
  if (item.hasWidth && positiveNumber(item.targetWidthCm) === undefined) {
    errors.targetWidthCm = "0보다 큰 폭(cm)을 입력해 주세요.";
  }
  if (
    item.hasCustom &&
    item.tieWidthCm.trim() !== "" &&
    positiveNumber(item.tieWidthCm) === undefined
  ) {
    errors.tieWidthCm = "0보다 큰 타이 폭(cm)을 입력해 주세요.";
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
  if (!/^01\d{8,9}$/.test(canonicalizePhoneNumber(draft.phone))) {
    errors.phone = "올바른 휴대폰 번호를 입력해 주세요.";
  }
  if (nonNegativeInteger(draft.amount) === undefined) {
    errors.amount = "0 이상의 정수를 입력해 주세요.";
  }
  const discount = nonNegativeInteger(draft.discount);
  if (discount === undefined) {
    errors.discount = "0 이상의 정수를 입력해 주세요.";
  } else if (discount > (nonNegativeInteger(draft.amount) ?? 0)) {
    errors.discount = "할인은 금액을 넘을 수 없습니다.";
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
    custom: item.hasCustom
      ? {
          fabric_provided: item.fabricProvided,
          fabric_type: item.fabricProvided ? null : item.fabricType,
          design_type: item.fabricProvided ? null : item.designType,
          tie_type: item.tieType,
          dimple: item.tieType === "AUTO" && item.customDimple,
          turn_knot: item.tieType === "AUTO" && item.customTurnKnot,
          size_type: item.sizeType,
          tie_width_cm:
            item.tieWidthCm.trim() === "" ? null : Number(item.tieWidthCm),
          memo: item.customMemo.trim(),
        }
      : null,
    note: item.note.trim(),
    image_upload_ids: item.images.map((image) => image.id),
  };
}

export function manualOrderDraftBody(
  draft: ManualOrderDraft,
): ManualOrderCreateRequest {
  return {
    order_date: draft.orderDate,
    customer_name: draft.customerName.trim(),
    phone: canonicalizePhoneNumber(draft.phone),
    address: optionalText(draft.address),
    amount: Number(draft.amount),
    discount: Number(draft.discount),
    shipping_fee: Number(draft.shippingFee),
    is_received: draft.isReceived,
    is_paid: draft.isPaid,
    is_confirmed: draft.isConfirmed,
    items: draft.items.map(itemBody),
    image_upload_ids: draft.images.map((image) => image.id),
  };
}

function ImageAttachments({
  label,
  description,
  images,
  disabled,
  manualOrderId,
  onChange,
}: {
  label: string;
  description: string;
  images: ImageDraft[];
  disabled: boolean;
  /** 수정 화면에서만 있다 — 이미 저장된 이미지의 썸네일을 발급하는 데 쓴다. */
  manualOrderId?: string;
  onChange: (images: ImageDraft[]) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string>();
  // 저장된 이미지는 previewUrl이 없다 — 어느 사진을 지우는지 보이도록 읽기 URL을 발급한다.
  const [readUrls, setReadUrls] = useState<Record<string, string>>({});
  const requested = useRef(new Set<string>());
  // 업로드 대기 중에도 제거는 열려 있다 — 완료 시점의 최신 목록에 붙여야 지운 사진이 되살아나지 않는다.
  const latestImages = useRef(images);
  latestImages.current = images;

  useEffect(() => {
    if (manualOrderId === undefined) return;
    for (const image of images) {
      if (image.previewUrl !== undefined) continue;
      if (requested.current.has(image.id)) continue;
      requested.current.add(image.id);
      const imageId = image.id;
      void createManualOrderImageReadUrl({
        path: { manual_order_id: manualOrderId, image_id: imageId },
        throwOnError: true,
      })
        .then((result) =>
          setReadUrls((current) => ({
            ...current,
            [imageId]: result.data.read_url,
          })),
        )
        .catch(() => undefined); // 썸네일이 없어도 제거·저장은 된다.
    }
  }, [manualOrderId, images]);

  const add = async (files: File[]) => {
    setError(undefined);
    setUploading(true);
    const added: ImageDraft[] = [];
    try {
      for (const file of files) {
        added.push({
          id: await uploadManualOrderImage(file),
          label: `${file.type} · ${formatFileSize(file.size, "크기 미상")}`,
          previewUrl: URL.createObjectURL(file),
        });
      }
    } catch (uploadError) {
      setError(getErrorMessage(uploadError, "이미지를 업로드하지 못했습니다."));
    } finally {
      setUploading(false);
      if (added.length > 0) onChange([...latestImages.current, ...added]);
    }
  };

  return (
    <VStack gap="x2" alignItems="stretch">
      {error !== undefined && (
        <Callout role="alert" tone="critical" title={error} />
      )}
      <AttachmentDisplayField
        label={label}
        description={description}
        items={images.map((image) => ({
          id: image.id,
          src: image.previewUrl ?? readUrls[image.id],
          alt: image.label,
        }))}
        max={MAX_MANUAL_ORDER_IMAGES}
        accept={MANUAL_ORDER_IMAGE_ACCEPT}
        onRemove={(id) => onChange(images.filter((image) => image.id !== id))}
        onAddFiles={disabled ? undefined : (files) => void add(files)}
      />
      {uploading && (
        <Text textStyle="caption" color="fg.neutral-muted">
          이미지를 업로드하고 있습니다…
        </Text>
      )}
    </VStack>
  );
}

export type ManualOrderFormProps = {
  initial: ManualOrderDraft;
  revision?: string;
  /** 수정 화면에서만 넘긴다 — 저장된 첨부 이미지 썸네일 발급용. */
  manualOrderId?: string;
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
  manualOrderId,
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
  const orderAmount =
    (Number(draft.amount) || 0) -
    (Number(draft.discount) || 0) +
    (Number(draft.shippingFee) || 0);
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
              <TextField
                type="date"
                label="날짜"
                required
                value={draft.orderDate}
                errorMessage={attempted ? errors.orderDate : undefined}
                disabled={pending}
                onChange={(event) =>
                  update("orderDate", event.currentTarget.value)
                }
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
              <PhoneField
                label="휴대폰"
                required
                value={draft.phone}
                errorMessage={attempted ? errors.phone : undefined}
                disabled={pending}
                onValueChange={(value) => update("phone", value)}
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
              <NumberField
                label="금액"
                suffix="원"
                groupThousands
                required
                value={draft.amount}
                errorMessage={attempted ? errors.amount : undefined}
                disabled={pending}
                onValueChange={(value) => update("amount", value)}
              />
              <NumberField
                label="할인"
                suffix="원"
                groupThousands
                value={draft.discount}
                errorMessage={attempted ? errors.discount : undefined}
                disabled={pending}
                onValueChange={(value) => update("discount", value)}
              />
              <NumberField
                label="택배비"
                suffix="원"
                groupThousands
                value={draft.shippingFee}
                errorMessage={attempted ? errors.shippingFee : undefined}
                disabled={pending}
                onValueChange={(value) => update("shippingFee", value)}
              />
            </Grid>

            <Text textStyle="bodySm" color="fg.neutral-muted">
              원금 − 할인 + 택배비 = {formatMoney(orderAmount)}
            </Text>

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
          title="주문 품목"
          description="품목마다 대분류를 하나 이상 선택합니다. 돌려묶기·딤플은 자동수선의 지퍼 타입, 주문제작의 자동 봉제에서만 선택할 수 있습니다."
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
                  key={item.clientId}
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
                      <NumberField
                        label="수량"
                        suffix="개"
                        required
                        value={item.quantity}
                        errorMessage={itemErrors.quantity}
                        disabled={pending}
                        onValueChange={(quantity) =>
                          updateItem(index, { quantity })
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
                          <Checkbox
                            label="주문제작"
                            checked={item.hasCustom}
                            disabled={pending}
                            onChange={(event) =>
                              updateItem(index, {
                                hasCustom: event.currentTarget.checked,
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

                    {item.hasCustom && (
                      <VStack gap="x4" alignItems="stretch">
                        <Grid columns={{ base: 1, md: 2 }} gap="x4">
                          <VStack gap="x2" alignItems="stretch">
                            <Text as="h4" textStyle="labelSm">
                              [제작] 원단 준비
                            </Text>
                            <SegmentedControl
                              aria-label="주문제작 원단 준비"
                              value={item.fabricProvided ? "provided" : "own"}
                              onValueChange={(value) =>
                                updateItem(index, {
                                  fabricProvided: value === "provided",
                                })
                              }
                            >
                              <SegmentedControlItem value="own">
                                원단 제작
                              </SegmentedControlItem>
                              <SegmentedControlItem value="provided">
                                원단 제공
                              </SegmentedControlItem>
                            </SegmentedControl>
                          </VStack>
                          {!item.fabricProvided && (
                            <VStack gap="x2" alignItems="stretch">
                              <Text as="h4" textStyle="labelSm">
                                [제작] 원단
                              </Text>
                              <SegmentedControl
                                aria-label="주문제작 원단"
                                value={item.fabricType}
                                onValueChange={(value) =>
                                  updateItem(index, {
                                    fabricType:
                                      value === "SILK" ? "SILK" : "POLY",
                                  })
                                }
                              >
                                <SegmentedControlItem value="POLY">
                                  폴리
                                </SegmentedControlItem>
                                <SegmentedControlItem value="SILK">
                                  실크
                                </SegmentedControlItem>
                              </SegmentedControl>
                            </VStack>
                          )}
                          {!item.fabricProvided && (
                            <VStack gap="x2" alignItems="stretch">
                              <Text as="h4" textStyle="labelSm">
                                [제작] 디자인
                              </Text>
                              <SegmentedControl
                                aria-label="주문제작 디자인"
                                value={item.designType}
                                onValueChange={(value) =>
                                  updateItem(index, {
                                    designType:
                                      value === "YARN_DYED"
                                        ? "YARN_DYED"
                                        : "PRINTING",
                                  })
                                }
                              >
                                <SegmentedControlItem value="PRINTING">
                                  날염
                                </SegmentedControlItem>
                                <SegmentedControlItem value="YARN_DYED">
                                  선염
                                </SegmentedControlItem>
                              </SegmentedControl>
                            </VStack>
                          )}
                          <VStack gap="x2" alignItems="stretch">
                            <Text as="h4" textStyle="labelSm">
                              [제작] 봉제
                            </Text>
                            <SegmentedControl
                              aria-label="주문제작 봉제"
                              value={item.tieType}
                              onValueChange={(value) =>
                                updateItem(
                                  index,
                                  value === "AUTO"
                                    ? { tieType: "AUTO" }
                                    : {
                                        tieType: "MANUAL",
                                        customDimple: false,
                                        customTurnKnot: false,
                                      },
                                )
                              }
                            >
                              <SegmentedControlItem value="MANUAL">
                                수동
                              </SegmentedControlItem>
                              <SegmentedControlItem value="AUTO">
                                자동
                              </SegmentedControlItem>
                            </SegmentedControl>
                          </VStack>
                          <VStack gap="x2" alignItems="stretch">
                            <Text as="h4" textStyle="labelSm">
                              [제작] 마감
                            </Text>
                            <SegmentedControl
                              aria-label="주문제작 마감"
                              value={item.customTurnKnot ? "turnKnot" : "bang"}
                              onValueChange={(value) =>
                                updateItem(index, {
                                  customTurnKnot: value === "turnKnot",
                                })
                              }
                            >
                              <SegmentedControlItem value="bang">
                                방
                              </SegmentedControlItem>
                              <SegmentedControlItem
                                value="turnKnot"
                                disabled={item.tieType === "MANUAL"}
                              >
                                돌려묶기
                              </SegmentedControlItem>
                            </SegmentedControl>
                          </VStack>
                          <VStack gap="x2" alignItems="stretch">
                            <Text as="h4" textStyle="labelSm">
                              [제작] 딤플
                            </Text>
                            <SegmentedControl
                              aria-label="주문제작 딤플"
                              value={item.customDimple ? "dimple" : "basic"}
                              onValueChange={(value) =>
                                updateItem(index, {
                                  customDimple: value === "dimple",
                                })
                              }
                            >
                              <SegmentedControlItem value="basic">
                                기본
                              </SegmentedControlItem>
                              <SegmentedControlItem
                                value="dimple"
                                disabled={item.tieType === "MANUAL"}
                              >
                                딤플
                              </SegmentedControlItem>
                            </SegmentedControl>
                          </VStack>
                          <VStack gap="x2" alignItems="stretch">
                            <Text as="h4" textStyle="labelSm">
                              [제작] 규격
                            </Text>
                            <SegmentedControl
                              aria-label="주문제작 규격"
                              value={item.sizeType}
                              onValueChange={(value) =>
                                updateItem(index, {
                                  sizeType:
                                    value === "CHILD" ? "CHILD" : "ADULT",
                                })
                              }
                            >
                              <SegmentedControlItem value="ADULT">
                                성인용
                              </SegmentedControlItem>
                              <SegmentedControlItem value="CHILD">
                                아동용
                              </SegmentedControlItem>
                            </SegmentedControl>
                          </VStack>
                          <TextField
                            type="number"
                            min={1}
                            label="[제작] 타이 폭"
                            suffix="cm"
                            value={item.tieWidthCm}
                            errorMessage={itemErrors.tieWidthCm}
                            disabled={pending}
                            onChange={(event) =>
                              updateItem(index, {
                                tieWidthCm: event.currentTarget.value,
                              })
                            }
                          />
                        </Grid>
                        <TextAreaField
                          label="[제작] 내용"
                          rows={2}
                          maxLength={200}
                          value={item.customMemo}
                          disabled={pending}
                          onChange={(event) =>
                            updateItem(index, {
                              customMemo: event.currentTarget.value,
                            })
                          }
                        />
                      </VStack>
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

                    <ImageAttachments
                      label={`품목 ${index + 1} 사진`}
                      description={`시안·참고 사진을 ${MAX_MANUAL_ORDER_IMAGES}장까지`}
                      images={item.images}
                      disabled={pending}
                      manualOrderId={manualOrderId}
                      onChange={(images) => updateItem(index, { images })}
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
                    items: [...current.items, createItemDraft()],
                  }))
                }
              >
                품목 추가
              </ActionButton>
            </HStack>
          </VStack>
        </AdminCard>

        <AdminCard
          title="첨부 이미지"
          description="작업장에 넘길 사진입니다. 없어도 저장할 수 있습니다."
        >
          <ImageAttachments
            label="사진"
            description={`JPG · PNG · WebP, 10MB 이하, ${MAX_MANUAL_ORDER_IMAGES}장까지`}
            images={draft.images}
            disabled={pending}
            manualOrderId={manualOrderId}
            onChange={(images) => update("images", images)}
          />
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
