import type { AdminProductDetailOut } from "@essesion/api-client";
import {
  ActionButton,
  AlertDialog,
  AttachmentDisplayField,
  Callout,
  Checkbox,
  Grid,
  HStack,
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
import { FilterSelect } from "../../shared/ui/filter-select";
import {
  discardProductImageUpload,
  type ProductImageUploadResult,
  uploadProductImage,
} from "./upload";

export const PRODUCT_CATEGORIES = [
  { value: "3fold", label: "쓰리폴드" },
  { value: "sfolderato", label: "스폴데라토" },
  { value: "knit", label: "니트" },
  { value: "bowtie", label: "보타이" },
] as const;
export const PRODUCT_COLORS = [
  { value: "black", label: "블랙" },
  { value: "navy", label: "네이비" },
  { value: "gray", label: "그레이" },
  { value: "wine", label: "와인" },
  { value: "blue", label: "블루" },
  { value: "brown", label: "브라운" },
  { value: "beige", label: "베이지" },
  { value: "silver", label: "실버" },
] as const;
export const PRODUCT_PATTERNS = [
  { value: "solid", label: "솔리드" },
  { value: "stripe", label: "스트라이프" },
  { value: "dot", label: "도트" },
  { value: "check", label: "체크" },
  { value: "paisley", label: "페이즐리" },
] as const;
export const PRODUCT_MATERIALS = [
  { value: "silk", label: "실크" },
  { value: "cotton", label: "코튼" },
  { value: "polyester", label: "폴리에스터" },
  { value: "wool", label: "울" },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];
export type ProductColor = (typeof PRODUCT_COLORS)[number]["value"];
export type ProductPattern = (typeof PRODUCT_PATTERNS)[number]["value"];
export type ProductMaterial = (typeof PRODUCT_MATERIALS)[number]["value"];

export type ProductImageDraft = {
  clientId: string;
  uploadId: string | null;
  src: string;
  staged: boolean;
};

export type ProductOptionDraft = {
  clientId: string;
  id?: string;
  name: string;
  additionalPrice: string;
  stock: string;
  unlimitedStock: boolean;
};

export type ProductDraft = {
  name: string;
  code: string;
  price: string;
  category: ProductCategory;
  color: ProductColor;
  pattern: ProductPattern;
  material: ProductMaterial;
  info: string;
  stock: string;
  unlimitedStock: boolean;
  optionLabel: string;
  options: ProductOptionDraft[];
  primaryImage: ProductImageDraft | null;
  detailImages: ProductImageDraft[];
};

type ProductWithImageIds = AdminProductDetailOut & {
  image_upload_id: string | null;
  detail_image_upload_ids?: string[];
};

export const emptyProductDraft: ProductDraft = {
  name: "",
  code: "",
  price: "",
  category: "3fold",
  color: "navy",
  pattern: "solid",
  material: "silk",
  info: "",
  stock: "",
  unlimitedStock: true,
  optionLabel: "",
  options: [],
  primaryImage: null,
  detailImages: [],
};

export function productDraftFromDetail(
  product: ProductWithImageIds,
): ProductDraft {
  return {
    name: product.name,
    code: product.code ?? "",
    price: String(product.price),
    category: product.category as ProductCategory,
    color: product.color as ProductColor,
    pattern: product.pattern as ProductPattern,
    material: product.material as ProductMaterial,
    info: product.info,
    stock: product.stock === null ? "" : String(product.stock),
    unlimitedStock: product.stock === null,
    optionLabel: product.option_label ?? "",
    options: (product.options ?? []).map((option) => ({
      clientId: option.id,
      id: option.id,
      name: option.name,
      additionalPrice: String(option.additional_price),
      stock: option.stock === null ? "" : String(option.stock),
      unlimitedStock: option.stock === null,
    })),
    primaryImage:
      product.image_upload_id === null
        ? {
            clientId: "legacy-primary",
            uploadId: null,
            src: product.image,
            staged: false,
          }
        : {
            clientId: product.image_upload_id,
            uploadId: product.image_upload_id,
            src: product.image,
            staged: false,
          },
    detailImages: (product.detail_images ?? []).map((src, index) => {
      const uploadId = product.detail_image_upload_ids?.[index] ?? null;
      return {
        clientId: uploadId ?? `legacy-detail-${index}`,
        uploadId,
        src,
        staged: false,
      };
    }),
  };
}

export type ProductFormValue = {
  name: string;
  code: string | null;
  price: number;
  category: ProductCategory;
  color: ProductColor;
  pattern: ProductPattern;
  material: ProductMaterial;
  info: string;
  stock: number | null;
  optionLabel: string | null;
  options: Array<{
    id?: string;
    name: string;
    additionalPrice: number;
    stock: number | null;
  }>;
  imageUploadId?: string;
  detailImageUploadIds?: string[];
};

type ProductDraftErrors = {
  name?: string;
  price?: string;
  info?: string;
  stock?: string;
  optionLabel?: string;
  primaryImage?: string;
  options: Record<
    string,
    { name?: string; additionalPrice?: string; stock?: string }
  >;
};

function nonNegativeInteger(value: string) {
  if (!/^\d+$/.test(value)) return undefined;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function validateDraft(
  draft: ProductDraft,
  mode: ProductFormProps["mode"],
): ProductDraftErrors {
  const errors: ProductDraftErrors = { options: {} };
  if (draft.name.trim() === "") errors.name = "상품 이름을 입력해 주세요.";
  if (nonNegativeInteger(draft.price) === undefined) {
    errors.price = "가격은 0 이상의 정수여야 합니다.";
  }
  if (draft.info.trim() === "") errors.info = "상품 설명을 입력해 주세요.";
  if (
    draft.options.length === 0 &&
    !draft.unlimitedStock &&
    nonNegativeInteger(draft.stock) === undefined
  ) {
    errors.stock = "재고는 0 이상의 정수여야 합니다.";
  }
  if (draft.options.length > 0 && draft.optionLabel.trim() === "") {
    errors.optionLabel = "옵션 묶음 이름을 입력해 주세요.";
  }
  if (
    draft.primaryImage === null ||
    (mode === "create" && draft.primaryImage.uploadId === null)
  ) {
    errors.primaryImage = "대표 이미지를 업로드해 주세요.";
  }

  const nameCounts = new Map<string, number>();
  for (const option of draft.options) {
    const name = option.name.trim();
    if (name !== "") nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const option of draft.options) {
    const optionErrors: ProductDraftErrors["options"][string] = {};
    const name = option.name.trim();
    if (name === "") optionErrors.name = "옵션 이름을 입력해 주세요.";
    else if ((nameCounts.get(name) ?? 0) > 1) {
      optionErrors.name = "같은 옵션 이름을 중복할 수 없습니다.";
    }
    if (nonNegativeInteger(option.additionalPrice) === undefined) {
      optionErrors.additionalPrice = "추가 금액은 0 이상의 정수여야 합니다.";
    }
    if (
      !option.unlimitedStock &&
      nonNegativeInteger(option.stock) === undefined
    ) {
      optionErrors.stock = "재고는 0 이상의 정수여야 합니다.";
    }
    if (Object.keys(optionErrors).length > 0) {
      errors.options[option.clientId] = optionErrors;
    }
  }
  return errors;
}

function hasErrors(errors: ProductDraftErrors) {
  return (
    Object.entries(errors).some(
      ([key, value]) => key !== "options" && value !== undefined,
    ) || Object.keys(errors.options).length > 0
  );
}

function sameImage(
  left: ProductImageDraft | null,
  right: ProductImageDraft | null,
) {
  return left?.uploadId === right?.uploadId && left?.src === right?.src;
}

function sameImageList(left: ProductImageDraft[], right: ProductImageDraft[]) {
  return (
    left.length === right.length &&
    left.every((image, index) => sameImage(image, right[index] ?? null))
  );
}

function toFormValue(
  draft: ProductDraft,
  baseDraft: ProductDraft,
  mode: ProductFormProps["mode"],
): ProductFormValue {
  const includePrimary =
    mode === "create" || !sameImage(draft.primaryImage, baseDraft.primaryImage);
  const includeDetails =
    mode === "create" ||
    !sameImageList(draft.detailImages, baseDraft.detailImages);
  return {
    name: draft.name.trim(),
    code: draft.code.trim() || null,
    price: Number(draft.price),
    category: draft.category,
    color: draft.color,
    pattern: draft.pattern,
    material: draft.material,
    info: draft.info.trim(),
    stock:
      draft.options.length > 0 || draft.unlimitedStock
        ? null
        : Number(draft.stock),
    optionLabel:
      draft.options.length === 0 ? null : draft.optionLabel.trim() || null,
    options: draft.options.map((option) => ({
      ...(option.id === undefined ? {} : { id: option.id }),
      name: option.name.trim(),
      additionalPrice: Number(option.additionalPrice),
      stock: option.unlimitedStock ? null : Number(option.stock),
    })),
    ...(includePrimary
      ? { imageUploadId: draft.primaryImage?.uploadId ?? "" }
      : {}),
    ...(includeDetails
      ? {
          detailImageUploadIds: draft.detailImages.flatMap((image) =>
            image.uploadId === null ? [] : [image.uploadId],
          ),
        }
      : {}),
  };
}

export type ProductFormProps = {
  initial: ProductDraft;
  revision?: string;
  resetSignal: number;
  mode: "create" | "edit";
  pending: boolean;
  error?: unknown;
  errorAction?: ReactNode;
  onSubmit: (value: ProductFormValue, revision?: string) => void;
};

export function ProductForm({
  initial,
  revision,
  resetSignal,
  mode,
  pending,
  error,
  errorAction,
  onSubmit,
}: ProductFormProps) {
  const [draft, setDraft] = useState(initial);
  const [baseDraft, setBaseDraft] = useState(initial);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [attempted, setAttempted] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const appliedReset = useRef(resetSignal);
  const errors = useMemo(() => validateDraft(draft, mode), [draft, mode]);
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseDraft),
    [baseDraft, draft],
  );
  const blocker = useDirtyFormBlocker(dirty);

  useEffect(() => {
    if (appliedReset.current === resetSignal) return;
    appliedReset.current = resetSignal;
    setDraft((current) => {
      const retainedIds = new Set(
        [initial.primaryImage, ...initial.detailImages]
          .filter((image): image is ProductImageDraft => image !== null)
          .map((image) => image.clientId),
      );
      for (const image of [current.primaryImage, ...current.detailImages]) {
        if (
          image?.staged &&
          image.uploadId !== null &&
          !retainedIds.has(image.clientId)
        ) {
          void discardProductImageUpload(image.uploadId);
        }
      }
      return initial;
    });
    setBaseDraft(initial);
    setBaseRevision(revision);
    setAttempted(false);
    setUploadError(undefined);
  }, [initial, resetSignal, revision]);

  const update = <Key extends keyof ProductDraft>(
    key: Key,
    value: ProductDraft[Key],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const updateOption = (
    clientId: string,
    changes: Partial<ProductOptionDraft>,
  ) => {
    setDraft((current) => ({
      ...current,
      options: current.options.map((option) =>
        option.clientId === clientId ? { ...option, ...changes } : option,
      ),
    }));
  };

  const upload = async (
    file: File,
    kind: "primary" | "detail",
  ): Promise<ProductImageDraft | undefined> => {
    setUploadError(undefined);
    setUploading((current) => current + 1);
    try {
      const result: ProductImageUploadResult = await uploadProductImage(
        file,
        kind,
      );
      return {
        clientId: result.uploadId,
        uploadId: result.uploadId,
        src: result.publicUrl,
        staged: true,
      };
    } catch (caught) {
      setUploadError(
        getErrorMessage(caught, "상품 이미지를 업로드하지 못했습니다."),
      );
      return undefined;
    } finally {
      setUploading((current) => current - 1);
    }
  };

  const addPrimary = async (files: File[]) => {
    const image = await upload(files[0] as File, "primary");
    if (image === undefined) return;
    setDraft((current) => {
      if (
        current.primaryImage?.staged &&
        current.primaryImage.uploadId !== null
      ) {
        void discardProductImageUpload(current.primaryImage.uploadId);
      }
      return { ...current, primaryImage: image };
    });
  };

  const addDetails = async (files: File[]) => {
    for (const file of files) {
      const image = await upload(file, "detail");
      if (image === undefined) continue;
      setDraft((current) => ({
        ...current,
        detailImages: [...current.detailImages, image].slice(0, 20),
      }));
    }
  };

  const removePrimary = () => {
    setDraft((current) => {
      if (
        current.primaryImage?.staged &&
        current.primaryImage.uploadId !== null
      ) {
        void discardProductImageUpload(current.primaryImage.uploadId);
      }
      return { ...current, primaryImage: null };
    });
  };

  const removeDetail = (clientId: string) => {
    setDraft((current) => {
      const image = current.detailImages.find(
        (item) => item.clientId === clientId,
      );
      if (image?.staged && image.uploadId !== null) {
        void discardProductImageUpload(image.uploadId);
      }
      return {
        ...current,
        detailImages: current.detailImages.filter(
          (item) => item.clientId !== clientId,
        ),
      };
    });
  };

  const discardStaged = () => {
    const staged = [draft.primaryImage, ...draft.detailImages].filter(
      (image): image is ProductImageDraft => image?.staged === true,
    );
    void Promise.allSettled(
      staged.flatMap((image) =>
        image.uploadId === null
          ? []
          : [discardProductImageUpload(image.uploadId)],
      ),
    );
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (hasErrors(errors) || pending || uploading > 0) return;
    onSubmit(toFormValue(draft, baseDraft, mode), baseRevision);
  };

  return (
    <>
      <VStack
        as="form"
        gap="x5"
        alignItems="stretch"
        noValidate
        onSubmit={submit}
      >
        {attempted && hasErrors(errors) && (
          <Callout
            role="alert"
            tone="critical"
            title="입력한 상품 정보를 확인해 주세요"
          />
        )}

        <AdminCard title="기본 정보">
          <VStack gap="x4" alignItems="stretch">
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <TextField
                label="상품 이름"
                required
                maxLength={200}
                value={draft.name}
                errorMessage={attempted ? errors.name : undefined}
                disabled={pending}
                onChange={(event) => update("name", event.currentTarget.value)}
              />
              <TextField
                label="상품 코드"
                description={
                  mode === "create"
                    ? "비워 두면 카테고리 기준으로 자동 생성됩니다."
                    : "등록 후에는 변경할 수 없습니다."
                }
                maxLength={100}
                value={draft.code}
                disabled={mode === "edit" || pending}
                onChange={(event) => update("code", event.currentTarget.value)}
              />
            </Grid>
            <TextAreaField
              label="상품 설명"
              required
              rows={5}
              maxLength={5000}
              value={draft.info}
              errorMessage={attempted ? errors.info : undefined}
              disabled={pending}
              onChange={(event) => update("info", event.currentTarget.value)}
            />
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <FilterSelect
                label="카테고리"
                value={draft.category}
                options={PRODUCT_CATEGORIES}
                disabled={pending}
                onChange={(event) =>
                  update(
                    "category",
                    event.currentTarget.value as ProductCategory,
                  )
                }
              />
              <FilterSelect
                label="색상"
                value={draft.color}
                options={PRODUCT_COLORS}
                disabled={pending}
                onChange={(event) =>
                  update("color", event.currentTarget.value as ProductColor)
                }
              />
              <FilterSelect
                label="패턴"
                value={draft.pattern}
                options={PRODUCT_PATTERNS}
                disabled={pending}
                onChange={(event) =>
                  update("pattern", event.currentTarget.value as ProductPattern)
                }
              />
              <FilterSelect
                label="소재"
                value={draft.material}
                options={PRODUCT_MATERIALS}
                disabled={pending}
                onChange={(event) =>
                  update(
                    "material",
                    event.currentTarget.value as ProductMaterial,
                  )
                }
              />
            </Grid>
          </VStack>
        </AdminCard>

        <AdminCard
          title="이미지"
          description="JPG·PNG·WebP, 파일당 10MB 이하입니다. 업로드 완료 후 상품 저장 시 관계가 확정됩니다."
        >
          <VStack gap="x5" alignItems="stretch">
            <AttachmentDisplayField
              label="대표 이미지"
              description="상품 목록과 상세의 대표 이미지입니다."
              errorMessage={attempted ? errors.primaryImage : undefined}
              items={
                draft.primaryImage === null
                  ? []
                  : [
                      {
                        id: draft.primaryImage.clientId,
                        src: draft.primaryImage.src,
                        alt: "상품 대표 이미지",
                      },
                    ]
              }
              max={1}
              accept="image/jpeg,image/png,image/webp"
              addLabel="대표 이미지 추가"
              onAddFiles={(files) => void addPrimary(files)}
              onRemove={removePrimary}
            />
            <AttachmentDisplayField
              label="상세 이미지"
              description="최대 20장까지 순서대로 표시됩니다."
              items={draft.detailImages.map((image, index) => ({
                id: image.clientId,
                src: image.src,
                alt: `상품 상세 이미지 ${index + 1}`,
              }))}
              max={20}
              accept="image/jpeg,image/png,image/webp"
              addLabel="상세 이미지 추가"
              onAddFiles={(files) => void addDetails(files)}
              onRemove={removeDetail}
            />
            {uploading > 0 && (
              <Callout
                tone="informative"
                title="이미지를 업로드하고 있습니다"
                description="업로드 확인이 끝나면 상품을 저장할 수 있습니다."
              />
            )}
            {uploadError !== undefined && (
              <Callout role="alert" tone="critical" title={uploadError} />
            )}
          </VStack>
        </AdminCard>

        <AdminCard title="가격·재고">
          <Grid columns={{ base: 1, md: 2 }} gap="x4">
            <TextField
              type="number"
              min={0}
              step={1}
              label="기본 가격"
              suffix="원"
              required
              value={draft.price}
              errorMessage={attempted ? errors.price : undefined}
              disabled={pending}
              onChange={(event) => update("price", event.currentTarget.value)}
            />
            {draft.options.length === 0 ? (
              <VStack gap="x2" alignItems="stretch">
                <TextField
                  type="number"
                  min={0}
                  step={1}
                  label="상품 재고"
                  suffix="개"
                  required={!draft.unlimitedStock}
                  value={draft.stock}
                  errorMessage={attempted ? errors.stock : undefined}
                  disabled={draft.unlimitedStock || pending}
                  onChange={(event) =>
                    update("stock", event.currentTarget.value)
                  }
                />
                <Checkbox
                  label="재고 수량 제한 없음"
                  checked={draft.unlimitedStock}
                  disabled={pending}
                  onChange={(event) =>
                    update("unlimitedStock", event.currentTarget.checked)
                  }
                />
              </VStack>
            ) : (
              <Callout
                tone="neutral"
                title="재고는 옵션별로 관리됩니다"
                description="옵션이 하나 이상이면 상품 단위 재고는 저장하지 않습니다."
              />
            )}
          </Grid>
        </AdminCard>

        <AdminCard
          title="옵션"
          description="기존 옵션 ID를 유지한 채 추가·수정·제거됩니다."
          action={
            <ActionButton
              variant="neutralOutline"
              disabled={pending || draft.options.length >= 100}
              onClick={() =>
                update("options", [
                  ...draft.options,
                  {
                    clientId: crypto.randomUUID(),
                    name: "",
                    additionalPrice: "0",
                    stock: "",
                    unlimitedStock: true,
                  },
                ])
              }
            >
              옵션 추가
            </ActionButton>
          }
        >
          <VStack gap="x4" alignItems="stretch">
            {draft.options.length === 0 ? (
              <Text color="fg.neutral-muted">
                옵션이 없습니다. 상품 단위 재고를 사용합니다.
              </Text>
            ) : (
              <>
                <TextField
                  label="옵션 묶음 이름"
                  description="예: 길이, 사이즈, 색상"
                  required
                  maxLength={100}
                  value={draft.optionLabel}
                  errorMessage={attempted ? errors.optionLabel : undefined}
                  disabled={pending}
                  onChange={(event) =>
                    update("optionLabel", event.currentTarget.value)
                  }
                />
                {draft.options.map((option, index) => {
                  const optionErrors = errors.options[option.clientId];
                  return (
                    <AdminCard
                      key={option.clientId}
                      title={`옵션 ${index + 1}`}
                      description={
                        option.id === undefined
                          ? "새 옵션"
                          : `기존 옵션 ID ${option.id}`
                      }
                      action={
                        <ActionButton
                          variant="ghost"
                          size="small"
                          disabled={pending}
                          onClick={() =>
                            update(
                              "options",
                              draft.options.filter(
                                (item) => item.clientId !== option.clientId,
                              ),
                            )
                          }
                        >
                          제거
                        </ActionButton>
                      }
                    >
                      <Grid columns={{ base: 1, md: 3 }} gap="x4">
                        <TextField
                          label="옵션 이름"
                          required
                          maxLength={100}
                          value={option.name}
                          errorMessage={
                            attempted ? optionErrors?.name : undefined
                          }
                          disabled={pending}
                          onChange={(event) =>
                            updateOption(option.clientId, {
                              name: event.currentTarget.value,
                            })
                          }
                        />
                        <TextField
                          type="number"
                          min={0}
                          step={1}
                          label="추가 금액"
                          suffix="원"
                          required
                          value={option.additionalPrice}
                          errorMessage={
                            attempted
                              ? optionErrors?.additionalPrice
                              : undefined
                          }
                          disabled={pending}
                          onChange={(event) =>
                            updateOption(option.clientId, {
                              additionalPrice: event.currentTarget.value,
                            })
                          }
                        />
                        <VStack gap="x2" alignItems="stretch">
                          <TextField
                            type="number"
                            min={0}
                            step={1}
                            label="옵션 재고"
                            suffix="개"
                            required={!option.unlimitedStock}
                            value={option.stock}
                            errorMessage={
                              attempted ? optionErrors?.stock : undefined
                            }
                            disabled={option.unlimitedStock || pending}
                            onChange={(event) =>
                              updateOption(option.clientId, {
                                stock: event.currentTarget.value,
                              })
                            }
                          />
                          <Checkbox
                            label="재고 수량 제한 없음"
                            checked={option.unlimitedStock}
                            disabled={pending}
                            onChange={(event) =>
                              updateOption(option.clientId, {
                                unlimitedStock: event.currentTarget.checked,
                              })
                            }
                          />
                        </VStack>
                      </Grid>
                    </AdminCard>
                  );
                })}
              </>
            )}
          </VStack>
        </AdminCard>

        {error != null && (
          <VStack gap="x3" alignItems="stretch">
            <Callout
              role="alert"
              tone="critical"
              title="상품을 저장하지 못했습니다"
              description={getErrorMessage(
                error,
                "다른 관리자의 변경 또는 입력 조건을 확인해 주세요. 현재 입력은 보존됩니다.",
              )}
            />
            {errorAction}
          </VStack>
        )}

        <HStack gap="x2" wrap>
          <ActionButton type="submit" loading={pending || uploading > 0}>
            {mode === "create" ? "상품 등록" : "상품 변경 저장"}
          </ActionButton>
          <ActionButton
            variant="ghost"
            disabled={!dirty || pending || uploading > 0}
            onClick={() => {
              discardStaged();
              setDraft(baseDraft);
              setAttempted(false);
              setUploadError(undefined);
            }}
          >
            변경 취소
          </ActionButton>
        </HStack>
      </VStack>

      <AlertDialog
        open={blocker.state === "blocked"}
        title="저장하지 않은 상품 변경을 버릴까요?"
        description="입력한 상품 정보와 아직 확정하지 않은 이미지가 사라집니다."
        primaryActionProps={{
          children: "변경 버리기",
          variant: "criticalSolid",
          onClick: () => {
            discardStaged();
            blocker.proceed?.();
          },
        }}
        secondaryActionProps={{
          children: "계속 편집",
          onClick: () => blocker.reset?.(),
        }}
      />
    </>
  );
}
