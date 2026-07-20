import type { UserMotifOut } from "@essesion/api-client";
import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Callout,
  HStack,
  ImageFrame,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Text,
  VStack,
} from "@essesion/shared";
import { useEffect, useId, useRef, useState } from "react";

import {
  DESIGN_PHOTO_ACCEPT,
  importDesignMotifSvg,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import { previewPhotoMotif } from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import { validateImageFile } from "@/shared/lib/upload";

export type MotifSourcePhoto = {
  id: string;
  name: string;
  previewSrc: string;
};

export type PhotoMotifModalProps = {
  open: boolean;
  photos: readonly MotifSourcePhoto[];
  onOpenChange: (open: boolean) => void;
  onEnsurePhotoUpload: (photoId: string) => Promise<string>;
  onCreated: (motif: UserMotifOut) => void;
};

type Simplification = "low" | "medium" | "high";

/**
 * 사진 벡터화 모티프 — 단계형 단일 CTA.
 * 결과가 없으면 푸터 CTA가 "자동 분리·벡터화", 결과가 나오면 같은 자리가 "내 모티프에 저장"이 된다.
 */
export function PhotoMotifModal({
  open,
  photos,
  onOpenChange,
  onEnsurePhotoUpload,
  onCreated,
}: PhotoMotifModalProps) {
  const formId = useId();
  const [photoSourceId, setPhotoSourceId] = useState("");
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newPhotoUploadId, setNewPhotoUploadId] = useState<string | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [simplification, setSimplification] =
    useState<Simplification>("medium");
  const [colorCount, setColorCount] = useState(4);
  const [resultSvg, setResultSvg] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [processedPreview, setProcessedPreview] = useState<string | null>(null);
  const [backgroundConfidence, setBackgroundConfidence] = useState<
    number | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
    requestSequence.current += 1;
    setBusy(false);
    setSaving(false);
    setPhotoSourceId(open ? (photos[0]?.id ?? "new") : "");
    setNewPhoto(null);
    setNewPhotoUploadId(null);
    setNewPhotoPreview(null);
    setRemoveBackground(true);
    setSimplification("medium");
    setColorCount(4);
    setResultSvg(null);
    setWarnings([]);
    setProcessedPreview(null);
    setBackgroundConfidence(null);
    setError(null);
  }, [open]);

  useEffect(
    () => () => {
      if (newPhotoPreview) URL.revokeObjectURL(newPhotoPreview);
    },
    [newPhotoPreview],
  );

  const invalidateResult = () => {
    requestSequence.current += 1;
    setBusy(false);
    setResultSvg(null);
    setWarnings([]);
    setProcessedPreview(null);
    setBackgroundConfidence(null);
    setError(null);
  };

  const isCurrentRequest = (sequence: number) =>
    openRef.current && requestSequence.current === sequence;

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen && saving) return;
    if (!nextOpen) {
      openRef.current = false;
      requestSequence.current += 1;
      setBusy(false);
    }
    onOpenChange(nextOpen);
  };

  const selectNewPhoto = (file: File) => {
    try {
      validateImageFile(file, "사진은 장당 10MB 이하로 선택해 주세요.");
    } catch (cause) {
      setError(designErrorMessage(cause, "사진을 확인해 주세요."));
      return;
    }
    if (newPhotoPreview) URL.revokeObjectURL(newPhotoPreview);
    setNewPhoto(file);
    setNewPhotoUploadId(null);
    setNewPhotoPreview(URL.createObjectURL(file));
    setPhotoSourceId("new");
    invalidateResult();
  };

  const vectorize = async () => {
    if (!photoSourceId || busy) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const uploadId =
        photoSourceId === "new"
          ? newPhoto
            ? (newPhotoUploadId ?? (await uploadDesignPhoto(newPhoto)))
            : null
          : await onEnsurePhotoUpload(photoSourceId);
      if (!uploadId) throw new Error("벡터화할 사진을 선택해 주세요.");
      if (!isCurrentRequest(sequence)) return;
      if (photoSourceId === "new" && !newPhotoUploadId) {
        setNewPhotoUploadId(uploadId);
      }
      const preview = await previewPhotoMotif({
        uploadId,
        removeBackground,
        simplification,
        colorCount,
      });
      if (!isCurrentRequest(sequence)) return;
      setResultSvg(preview.svg);
      setWarnings(preview.warnings);
      setProcessedPreview(preview.processed_preview_base64 ?? null);
      setBackgroundConfidence(preview.background_confidence);
    } catch (cause) {
      if (!isCurrentRequest(sequence)) return;
      setResultSvg(null);
      setWarnings([]);
      setProcessedPreview(null);
      setBackgroundConfidence(null);
      setError(
        designErrorMessage(cause, "사진을 SVG 모티프로 만들지 못했습니다."),
      );
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  };

  const save = async () => {
    if (!resultSvg || busy || saving) return;
    const photoName =
      photoSourceId === "new"
        ? newPhoto?.name
        : photos.find((photo) => photo.id === photoSourceId)?.name;
    const name = (photoName ?? "사진 모티프")
      .replace(/\.[^.]+$/, "")
      .slice(0, 100);
    const sequence = ++requestSequence.current;
    setSaving(true);
    setError(null);
    try {
      const motif = await importDesignMotifSvg(name, resultSvg);
      if (!isCurrentRequest(sequence)) return;
      onCreated(motif);
      openRef.current = false;
      requestSequence.current += 1;
      setSaving(false);
      onOpenChange(false);
    } catch (cause) {
      if (!isCurrentRequest(sequence)) return;
      setError(designErrorMessage(cause, "모티프를 저장하지 못했습니다."));
    } finally {
      if (sequence === requestSequence.current) setSaving(false);
    }
  };

  const selectedPhoto = photos.find((photo) => photo.id === photoSourceId);
  const originalPreview =
    photoSourceId === "new" ? newPhotoPreview : selectedPhoto?.previewSrc;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={changeOpen}
      title="사진으로 모티프 만들기"
      description="로고·아이콘처럼 윤곽이 분명한 사진이 가장 잘 맞아요."
      size="medium"
      showCloseButton={!saving}
      closeOnEscape={!saving}
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={busy || saving}
            onClick={() => changeOpen(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="submit"
            form={formId}
            width="full"
            loading={busy || saving}
            disabled={!originalPreview}
          >
            {resultSvg ? "내 모티프에 저장" : "자동 분리·벡터화"}
          </Box>
        </HStack>
      }
    >
      <Box
        as="form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void (resultSvg ? save() : vectorize());
        }}
      >
        <fieldset disabled={saving} className="contents">
          <VStack gap="x4" alignItems="stretch">
            {photos.length > 0 ? (
              <RadioGroup
                value={photoSourceId}
                onValueChange={(value) => {
                  setPhotoSourceId(value);
                  invalidateResult();
                }}
                aria-label="모티프로 만들 사진"
              >
                {photos.map((photo) => (
                  <RadioGroupItem
                    key={photo.id}
                    value={photo.id}
                    label={photo.name}
                  />
                ))}
                <RadioGroupItem value="new" label="새 사진 선택" />
              </RadioGroup>
            ) : null}
            {photoSourceId === "new" || photos.length === 0 ? (
              <AttachmentDisplayField
                label="새 사진"
                description="JPEG, PNG, WebP · 10MB 이하"
                items={
                  newPhotoPreview
                    ? [
                        {
                          id: "new",
                          src: newPhotoPreview,
                          alt: newPhoto?.name,
                        },
                      ]
                    : []
                }
                max={1}
                accept={DESIGN_PHOTO_ACCEPT}
                addLabel="벡터화할 사진 선택"
                onAddFiles={(files) => {
                  const file = files[0];
                  if (file) selectNewPhoto(file);
                }}
                onRemove={() => {
                  if (newPhotoPreview) URL.revokeObjectURL(newPhotoPreview);
                  setNewPhoto(null);
                  setNewPhotoUploadId(null);
                  setNewPhotoPreview(null);
                  invalidateResult();
                }}
              />
            ) : null}

            {originalPreview ? (
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="label">원본 미리보기</Text>
                <Box maxWidth={240}>
                  <ImageFrame
                    ratio={1}
                    src={originalPreview}
                    alt="벡터화할 원본"
                    fit="contain"
                    stroke
                  />
                </Box>
              </VStack>
            ) : null}

            <RadioGroup
              value={removeBackground ? "remove" : "include"}
              onValueChange={(value) => {
                setRemoveBackground(value === "remove");
                invalidateResult();
              }}
              orientation="horizontal"
              aria-label="배경 처리"
            >
              <RadioGroupItem value="remove" label="배경 제거" />
              <RadioGroupItem value="include" label="배경 포함" />
            </RadioGroup>

            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="label">단순화 강도</Text>
              <SelectBox
                value={simplification}
                onValueChange={(value) => {
                  setSimplification(value as Simplification);
                  invalidateResult();
                }}
                columns={3}
                aria-label="단순화 강도"
              >
                <SelectBoxItem value="low" label="낮게" />
                <SelectBoxItem value="medium" label="보통" />
                <SelectBoxItem value="high" label="높게" />
              </SelectBox>
            </VStack>

            <VStack gap="x2" alignItems="stretch">
              <Text textStyle="label">결과 색상 수</Text>
              <SelectBox
                value={String(colorCount)}
                onValueChange={(value) => {
                  setColorCount(Number(value));
                  invalidateResult();
                }}
                columns={3}
                aria-label="결과 색상 수"
              >
                {[1, 2, 3, 4, 5, 6].map((count) => (
                  <SelectBoxItem
                    key={count}
                    value={String(count)}
                    label={`${count}색`}
                  />
                ))}
              </SelectBox>
            </VStack>

            {processedPreview ? (
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="label">자동 분리 결과</Text>
                <Box maxWidth={240}>
                  <ImageFrame
                    ratio={1}
                    src={`data:image/png;base64,${processedPreview}`}
                    alt="배경 제거와 색상 단순화를 적용한 결과"
                    fit="contain"
                    stroke
                  />
                </Box>
              </VStack>
            ) : null}

            {resultSvg ? (
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="label">저장할 모티프</Text>
                <Box maxWidth={240}>
                  <ImageFrame
                    ratio={1}
                    src={svgToDataUri(resultSvg)}
                    alt="저장할 SVG 모티프 미리보기"
                    fit="contain"
                    stroke
                  />
                </Box>
                {backgroundConfidence !== null ? (
                  <Text textStyle="caption" color="fg.neutral-subtle">
                    배경 분리 신뢰도 {Math.round(backgroundConfidence * 100)}%
                  </Text>
                ) : null}
              </VStack>
            ) : null}

            {warnings.length > 0 ? (
              <Callout
                tone="warning"
                title="벡터화 안내"
                description={warnings.join(" ")}
              />
            ) : null}
            {error ? (
              <Callout
                tone="critical"
                title="모티프를 만들지 못했습니다"
                description={error}
              />
            ) : null}
          </VStack>
        </fieldset>
      </Box>
    </ResponsiveModal>
  );
}
