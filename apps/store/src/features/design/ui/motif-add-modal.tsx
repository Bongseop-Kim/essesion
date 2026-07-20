import type { UserMotifOut } from "@essesion/api-client";
import {
  ActionButton,
  AttachmentDisplayField,
  Box,
  Callout,
  Field,
  HStack,
  ImageFrame,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  TabContent,
  TabList,
  Tabs,
  TabTrigger,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useEffect, useId, useRef, useState } from "react";

import {
  DESIGN_PHOTO_ACCEPT,
  DESIGN_SVG_ACCEPT,
  importDesignMotifSvg,
  readDesignMotifSvg,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import {
  previewPhotoMotif,
  previewTextMotif,
} from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import { validateImageFile } from "@/shared/lib/upload";

export type MotifSourcePhoto = {
  id: string;
  name: string;
  previewSrc: string;
};

export type MotifAddModalProps = {
  open: boolean;
  photos: readonly MotifSourcePhoto[];
  onOpenChange: (open: boolean) => void;
  onEnsurePhotoUpload: (photoId: string) => Promise<string>;
  onCreated: (motif: UserMotifOut) => void;
};

type MotifTab = "svg" | "text" | "photo";
type FontId = "nanum-gothic" | "nanum-myeongjo";
type FontWeight = 400 | 700;
type Simplification = "low" | "medium" | "high";

export function MotifAddModal({
  open,
  photos,
  onOpenChange,
  onEnsurePhotoUpload,
  onCreated,
}: MotifAddModalProps) {
  const svgInputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const [tab, setTab] = useState<MotifTab>("svg");
  const [name, setName] = useState("");
  const [resultSvg, setResultSvg] = useState<string | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [text, setText] = useState("");
  const [fontId, setFontId] = useState<FontId>("nanum-gothic");
  const [fontWeight, setFontWeight] = useState<FontWeight>(400);
  const [letterSpacing, setLetterSpacing] = useState(0);
  const [photoSourceId, setPhotoSourceId] = useState("");
  const [newPhoto, setNewPhoto] = useState<File | null>(null);
  const [newPhotoUploadId, setNewPhotoUploadId] = useState<string | null>(null);
  const [newPhotoPreview, setNewPhotoPreview] = useState<string | null>(null);
  const [removeBackground, setRemoveBackground] = useState(true);
  const [simplification, setSimplification] =
    useState<Simplification>("medium");
  const [colorCount, setColorCount] = useState(4);
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
    if (!open) {
      setName("");
      setResultSvg(null);
      setSourceLabel("");
      setText("");
      setPhotoSourceId("");
      setNewPhoto(null);
      setNewPhotoUploadId(null);
      setNewPhotoPreview(null);
      setWarnings([]);
      setProcessedPreview(null);
      setBackgroundConfidence(null);
      setError(null);
      return;
    }
    setTab("svg");
    setName("");
    setResultSvg(null);
    setSourceLabel("");
    setText("");
    setFontId("nanum-gothic");
    setFontWeight(400);
    setLetterSpacing(0);
    setPhotoSourceId(photos[0]?.id ?? "new");
    setNewPhoto(null);
    setNewPhotoUploadId(null);
    setNewPhotoPreview(null);
    setRemoveBackground(true);
    setSimplification("medium");
    setColorCount(4);
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

  const clearPreview = () => {
    setResultSvg(null);
    setWarnings([]);
    setProcessedPreview(null);
    setBackgroundConfidence(null);
    setError(null);
  };

  const invalidatePreview = () => {
    requestSequence.current += 1;
    setBusy(false);
    clearPreview();
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

  const changeTab = (value: string) => {
    if (saving) return;
    requestSequence.current += 1;
    setBusy(false);
    setTab(value as MotifTab);
    setName("");
    setResultSvg(null);
    setSourceLabel("");
    setWarnings([]);
    setProcessedPreview(null);
    setBackgroundConfidence(null);
    setError(null);
  };

  const selectSvg = async (file: File) => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const svg = await readDesignMotifSvg(file);
      if (!isCurrentRequest(sequence)) return;
      setName(file.name.replace(/\.svg$/i, "").slice(0, 100));
      setSourceLabel(file.name);
      setResultSvg(svg);
      setProcessedPreview(null);
    } catch (cause) {
      if (!isCurrentRequest(sequence)) return;
      clearPreview();
      setError(designErrorMessage(cause, "SVG를 읽지 못했습니다."));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  };

  const makeTextPreview = async () => {
    if (!text.trim() || busy) return;
    const sequence = ++requestSequence.current;
    setBusy(true);
    setError(null);
    try {
      const preview = await previewTextMotif({
        text: text.trim(),
        fontId,
        fontWeight,
        letterSpacing,
      });
      if (!isCurrentRequest(sequence)) return;
      setResultSvg(preview.svg);
      setWarnings(preview.warnings);
      setProcessedPreview(null);
      setSourceLabel("텍스트 path 미리보기");
      if (!name.trim()) setName(text.trim().slice(0, 100));
    } catch (cause) {
      if (!isCurrentRequest(sequence)) return;
      clearPreview();
      setError(designErrorMessage(cause, "텍스트 모티프를 만들지 못했습니다."));
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
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
    invalidatePreview();
    setName(
      (current) => current || file.name.replace(/\.[^.]+$/, "").slice(0, 100),
    );
  };

  const makePhotoPreview = async () => {
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
      setSourceLabel("벡터화 결과");
      if (!name.trim()) {
        const photoName =
          photoSourceId === "new"
            ? newPhoto?.name
            : photos.find((photo) => photo.id === photoSourceId)?.name;
        setName(
          (photoName ?? "사진 모티프").replace(/\.[^.]+$/, "").slice(0, 100),
        );
      }
    } catch (cause) {
      if (!isCurrentRequest(sequence)) return;
      clearPreview();
      setError(
        designErrorMessage(cause, "사진을 SVG 모티프로 만들지 못했습니다."),
      );
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  };

  const save = async () => {
    if (!resultSvg || !name.trim() || busy || saving) return;
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

  const controlsBusy = busy || saving;

  const selectedPhoto = photos.find((photo) => photo.id === photoSourceId);
  const originalPreview =
    photoSourceId === "new" ? newPhotoPreview : selectedPhoto?.previewSrc;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={changeOpen}
      title="모티프 추가"
      description="어떤 입력이든 안전한 SVG로 정규화해 내 모티프에 저장해요."
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
            disabled={controlsBusy}
            onClick={() => changeOpen(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="submit"
            form={formId}
            width="full"
            loading={saving}
            disabled={!resultSvg || !name.trim() || busy}
          >
            내 모티프에 저장
          </Box>
        </HStack>
      }
    >
      <Box
        as="form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={saving} className="contents">
          <Tabs value={tab} onValueChange={changeTab}>
            <TabList triggerLayout="fill" aria-label="모티프 추가 방식">
              <TabTrigger value="svg" disabled={saving}>
                SVG 파일
              </TabTrigger>
              <TabTrigger value="text" disabled={saving}>
                텍스트·이니셜
              </TabTrigger>
              <TabTrigger value="photo" disabled={saving}>
                사진에서 만들기
              </TabTrigger>
            </TabList>

            <TabContent value="svg" className="pt-x5">
              <VStack gap="x4" alignItems="stretch">
                <input
                  ref={svgInputRef}
                  type="file"
                  accept={DESIGN_SVG_ACCEPT}
                  aria-label="SVG 파일 선택"
                  className="sr-only"
                  tabIndex={-1}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    event.currentTarget.value = "";
                    if (file) void selectSvg(file);
                  }}
                />
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  onClick={() => svgInputRef.current?.click()}
                  disabled={busy}
                >
                  {sourceLabel || "SVG 파일 선택"}
                </ActionButton>
                <Callout
                  tone="neutral"
                  title="SVG 안전 처리"
                  description="2MB 이하 SVG만 받으며 저장할 때 script, 외부 참조, 이벤트를 제거하고 path를 정규화해요."
                />
              </VStack>
            </TabContent>

            <TabContent value="text" className="pt-x5">
              <VStack gap="x4" alignItems="stretch">
                <TextField
                  label="짧은 글자"
                  description="한글·영문·숫자와 공백, 최대 20자"
                  maxLength={20}
                  value={text}
                  onChange={(event) => {
                    setText(event.currentTarget.value);
                    invalidatePreview();
                  }}
                />
                <VStack gap="x2" alignItems="stretch">
                  <Text textStyle="label">글꼴</Text>
                  <SelectBox
                    value={fontId}
                    onValueChange={(value) => {
                      setFontId(value as FontId);
                      invalidatePreview();
                    }}
                    columns={2}
                    aria-label="글꼴"
                  >
                    <SelectBoxItem value="nanum-gothic" label="나눔고딕" />
                    <SelectBoxItem value="nanum-myeongjo" label="나눔명조" />
                  </SelectBox>
                </VStack>
                <VStack gap="x2" alignItems="stretch">
                  <Text textStyle="label">굵기</Text>
                  <SelectBox
                    value={String(fontWeight)}
                    onValueChange={(value) => {
                      setFontWeight(Number(value) as FontWeight);
                      invalidatePreview();
                    }}
                    columns={2}
                    aria-label="글자 굵기"
                  >
                    <SelectBoxItem value="400" label="보통" />
                    <SelectBoxItem value="700" label="굵게" />
                  </SelectBox>
                </VStack>
                <Field
                  label="자간"
                  description={`${letterSpacing.toFixed(2)}em`}
                >
                  <input
                    type="range"
                    min="-0.2"
                    max="1"
                    step="0.05"
                    value={letterSpacing}
                    aria-label="자간"
                    onChange={(event) => {
                      setLetterSpacing(Number(event.currentTarget.value));
                      invalidatePreview();
                    }}
                    className="w-full accent-bg-brand-solid"
                  />
                </Field>
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  loading={busy}
                  disabled={!text.trim()}
                  onClick={() => void makeTextPreview()}
                >
                  path 미리보기 만들기
                </ActionButton>
              </VStack>
            </TabContent>

            <TabContent value="photo" className="pt-x5">
              <VStack gap="x4" alignItems="stretch">
                {photos.length > 0 ? (
                  <RadioGroup
                    value={photoSourceId}
                    onValueChange={(value) => {
                      setPhotoSourceId(value);
                      invalidatePreview();
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
                      invalidatePreview();
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

                <RadioGroup
                  value={removeBackground ? "remove" : "include"}
                  onValueChange={(value) => {
                    setRemoveBackground(value === "remove");
                    invalidatePreview();
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
                      invalidatePreview();
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
                      invalidatePreview();
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

                <Callout
                  tone="neutral"
                  title="평면 이미지에 가장 잘 맞아요"
                  description="현재 자동 분리는 로고·아이콘처럼 윤곽이 분명한 피사체에 최적화돼요. 복잡한 사진은 명시적으로 실패하거나 다시 처리하도록 안내해요."
                />
                <ActionButton
                  type="button"
                  variant="neutralOutline"
                  loading={busy}
                  disabled={!originalPreview}
                  onClick={() => void makePhotoPreview()}
                >
                  자동 분리·벡터화
                </ActionButton>
              </VStack>
            </TabContent>
          </Tabs>

          {resultSvg ? (
            <VStack gap="x3" alignItems="stretch" pt="x5">
              <Text textStyle="label">
                {sourceLabel || "SVG 결과 미리보기"}
              </Text>
              {tab === "svg" ? (
                <Callout
                  tone="neutral"
                  title="저장 후 안전한 미리보기를 표시해요"
                  description="선택한 원본은 외부 참조를 불러올 수 있어 화면에 열지 않아요. 서버가 sanitize·normalize한 결과만 내 모티프와 작성창에서 보여요."
                />
              ) : (
                <Box maxWidth={320}>
                  <ImageFrame
                    ratio={1}
                    src={svgToDataUri(resultSvg)}
                    alt="저장할 SVG 모티프 미리보기"
                    fit="contain"
                    stroke
                  />
                </Box>
              )}
              {backgroundConfidence !== null ? (
                <Text textStyle="caption" color="fg.neutral-subtle">
                  배경 분리 신뢰도 {Math.round(backgroundConfidence * 100)}%
                </Text>
              ) : null}
              <TextField
                label="내 모티프 이름"
                maxLength={100}
                required
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </VStack>
          ) : null}

          {warnings.length > 0 ? (
            <Callout
              tone="warning"
              title="미리보기 안내"
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
        </fieldset>
      </Box>
    </ResponsiveModal>
  );
}
