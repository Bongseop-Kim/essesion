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
  PRODUCT_CATEGORIES,
  PRODUCT_COLORS,
  PRODUCT_MATERIALS,
  PRODUCT_PATTERNS,
  type ProductCategory,
  type ProductColor,
  type ProductMaterial,
  type ProductPattern,
} from "./product-attributes";
import {
  hasProductDraftErrors,
  type ProductDraft,
  type ProductFormValue,
  type ProductImageDraft,
  type ProductOptionDraft,
  productFormValue,
  validateProductDraft,
} from "./product-form-model";
import {
  discardProductImageUpload,
  type ProductImageUploadResult,
  uploadProductImage,
} from "./upload";

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
  const [invalidSubmitCount, setInvalidSubmitCount] = useState(0);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string>();
  const appliedReset = useRef(resetSignal);
  const formRef = useRef<HTMLFormElement>(null);
  const draftRef = useRef(draft);
  const mounted = useRef(true);
  const discardedUploadIds = useRef(new Set<string>());
  draftRef.current = draft;

  const discardStagedImage = (image: ProductImageDraft | null | undefined) => {
    const uploadId = image?.staged ? image.uploadId : null;
    if (uploadId === null || discardedUploadIds.current.has(uploadId)) return;
    discardedUploadIds.current.add(uploadId);
    void discardProductImageUpload(uploadId);
  };

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const current = draftRef.current;
      for (const image of [current.primaryImage, ...current.detailImages]) {
        discardStagedImage(image);
      }
    };
  }, []);

  const errors = useMemo(
    () => validateProductDraft(draft, mode),
    [draft, mode],
  );
  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(baseDraft),
    [baseDraft, draft],
  );
  const blocker = useDirtyFormBlocker(dirty || uploading > 0);

  useEffect(() => {
    if (invalidSubmitCount === 0) return;
    formRef.current
      ?.querySelector<HTMLElement>("[aria-invalid='true']")
      ?.focus({ preventScroll: true });
  }, [invalidSubmitCount]);

  useEffect(() => {
    if (appliedReset.current === resetSignal) return;
    appliedReset.current = resetSignal;
    const retainedIds = new Set(
      [initial.primaryImage, ...initial.detailImages]
        .filter((image): image is ProductImageDraft => image !== null)
        .map((image) => image.clientId),
    );
    for (const image of [
      draftRef.current.primaryImage,
      ...draftRef.current.detailImages,
    ]) {
      if (!retainedIds.has(image?.clientId ?? "")) discardStagedImage(image);
    }
    draftRef.current = initial;
    setDraft(initial);
    setBaseDraft(initial);
    setBaseRevision(revision);
    setAttempted(false);
    setInvalidSubmitCount(0);
    setUploadError(undefined);
  }, [initial, resetSignal, revision]);

  const update = <Key extends keyof ProductDraft>(
    key: Key,
    value: ProductDraft[Key],
  ) => {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
  };

  const updateOption = (
    clientId: string,
    changes: Partial<ProductOptionDraft>,
  ) => {
    const current = draftRef.current;
    const next = {
      ...current,
      options: current.options.map((option) =>
        option.clientId === clientId ? { ...option, ...changes } : option,
      ),
    };
    draftRef.current = next;
    setDraft(next);
  };

  const upload = async (
    file: File,
    kind: "primary" | "detail",
  ): Promise<ProductImageDraft | undefined> => {
    if (!mounted.current) return undefined;
    setUploadError(undefined);
    setUploading((current) => current + 1);
    try {
      const result: ProductImageUploadResult = await uploadProductImage(
        file,
        kind,
      );
      const image = {
        clientId: result.uploadId,
        uploadId: result.uploadId,
        src: result.publicUrl,
        staged: true,
      };
      if (!mounted.current) {
        discardStagedImage(image);
        return undefined;
      }
      return image;
    } catch (caught) {
      if (mounted.current) {
        setUploadError(
          getErrorMessage(caught, "상품 이미지를 업로드하지 못했습니다."),
        );
      }
      return undefined;
    } finally {
      if (mounted.current) setUploading((current) => current - 1);
    }
  };

  const addPrimary = async (files: File[]) => {
    const image = await upload(files[0] as File, "primary");
    if (image === undefined) return;
    const current = draftRef.current;
    discardStagedImage(current.primaryImage);
    const next = { ...current, primaryImage: image };
    draftRef.current = next;
    setDraft(next);
  };

  const addDetails = async (files: File[]) => {
    for (const file of files) {
      if (!mounted.current) return;
      const image = await upload(file, "detail");
      if (image === undefined) continue;
      const current = draftRef.current;
      if (current.detailImages.length >= 20) {
        discardStagedImage(image);
        continue;
      }
      const next = {
        ...current,
        detailImages: [...current.detailImages, image],
      };
      draftRef.current = next;
      setDraft(next);
    }
  };

  const removePrimary = () => {
    const current = draftRef.current;
    discardStagedImage(current.primaryImage);
    const next = { ...current, primaryImage: null };
    draftRef.current = next;
    setDraft(next);
  };

  const removeDetail = (clientId: string) => {
    const current = draftRef.current;
    const image = current.detailImages.find(
      (item) => item.clientId === clientId,
    );
    discardStagedImage(image);
    const next = {
      ...current,
      detailImages: current.detailImages.filter(
        (item) => item.clientId !== clientId,
      ),
    };
    draftRef.current = next;
    setDraft(next);
  };

  const discardStaged = () => {
    const current = draftRef.current;
    const staged = [current.primaryImage, ...current.detailImages].filter(
      (image): image is ProductImageDraft => image?.staged === true,
    );
    for (const image of staged) discardStagedImage(image);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (hasProductDraftErrors(errors)) {
      setInvalidSubmitCount((current) => current + 1);
      return;
    }
    if (pending || uploading > 0) return;
    onSubmit(productFormValue(draft, baseDraft, mode), baseRevision);
  };
  const attachmentsLocked = pending || uploading > 0;

  return (
    <>
      <VStack
        as="form"
        ref={formRef}
        gap="x5"
        alignItems="stretch"
        noValidate
        onSubmit={submit}
      >
        {attempted && hasProductDraftErrors(errors) && (
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
                onValueChange={(value) =>
                  update("category", value as ProductCategory)
                }
              />
              <FilterSelect
                label="색상"
                value={draft.color}
                options={PRODUCT_COLORS}
                disabled={pending}
                onValueChange={(value) =>
                  update("color", value as ProductColor)
                }
              />
              <FilterSelect
                label="패턴"
                value={draft.pattern}
                options={PRODUCT_PATTERNS}
                disabled={pending}
                onValueChange={(value) =>
                  update("pattern", value as ProductPattern)
                }
              />
              <FilterSelect
                label="소재"
                value={draft.material}
                options={PRODUCT_MATERIALS}
                disabled={pending}
                onValueChange={(value) =>
                  update("material", value as ProductMaterial)
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
              onAddFiles={
                attachmentsLocked
                  ? undefined
                  : (files) => void addPrimary(files)
              }
              onRemove={attachmentsLocked ? undefined : removePrimary}
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
              onAddFiles={
                attachmentsLocked
                  ? undefined
                  : (files) => void addDetails(files)
              }
              onRemove={attachmentsLocked ? undefined : removeDetail}
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
              draftRef.current = baseDraft;
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
