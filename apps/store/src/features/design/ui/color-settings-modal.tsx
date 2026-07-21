import {
  ActionButton,
  Box,
  Callout,
  HStack,
  Icon,
  RadioGroup,
  RadioGroupItem,
  ResponsiveModal,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { PlusIcon, TrashIcon } from "@heroicons/react/24/outline";
import { useEffect, useId, useRef, useState } from "react";

import {
  type DesignPalette,
  normalizeHexColor,
  normalizePaletteColors,
} from "@/features/design/model/draft";
import { designErrorMessage } from "@/features/design/model/errors";

export type PaletteSourcePhoto = {
  id: string;
  name: string;
};

export type ColorSettingsModalProps = {
  open: boolean;
  value: DesignPalette;
  photos: readonly PaletteSourcePhoto[];
  onOpenChange: (open: boolean) => void;
  onApply: (value: DesignPalette) => void;
  onExtract: (photoId: string) => Promise<string[]>;
};

const EMPTY_FIXED_COLORS = ["", ""];
const PICKER_FALLBACK = `#${"000000"}`;

export function ColorSettingsModal({
  open,
  value,
  photos,
  onOpenChange,
  onApply,
  onExtract,
}: ColorSettingsModalProps) {
  const formId = useId();
  const [mode, setMode] = useState<DesignPalette["mode"]>(value.mode);
  const [colors, setColors] = useState<string[]>(
    value.mode === "fixed" ? value.colors : [],
  );
  const [sourcePhotoId, setSourcePhotoId] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const extractSequence = useRef(0);
  const openRef = useRef(open);
  const previousOpenRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
    if (previousOpenRef.current === open) return;
    previousOpenRef.current = open;
    extractSequence.current += 1;
    setExtracting(false);
    if (!open) return;
    setMode(value.mode);
    setColors(value.mode === "fixed" ? value.colors : []);
    setSourcePhotoId(photos[0]?.id ?? "");
    setError(null);
  }, [open, value.mode, value.colors, photos]);

  const chooseMode = (next: string) => {
    extractSequence.current += 1;
    setExtracting(false);
    const nextMode = next as DesignPalette["mode"];
    setMode(nextMode);
    if (nextMode === "fixed" && colors.length === 0) {
      setColors(EMPTY_FIXED_COLORS);
    }
    setError(null);
  };

  const submit = () => {
    if (mode === "auto") {
      onApply({ mode: "auto", colors: [] });
      onOpenChange(false);
      return;
    }
    if (colors.some((color) => normalizeHexColor(color) === null)) {
      setError("HEX 색상을 #RRGGBB 또는 #RGB 형식으로 입력해 주세요.");
      return;
    }
    const normalized = normalizePaletteColors(colors);
    if (normalized.length < 2 || normalized.length > 5) {
      setError("서로 다른 색상을 2개 이상 5개 이하로 선택해 주세요.");
      return;
    }
    onApply({ mode: "fixed", colors: normalized });
    onOpenChange(false);
  };

  const extract = async () => {
    if (!sourcePhotoId || extracting) return;
    const sequence = ++extractSequence.current;
    setExtracting(true);
    setError(null);
    try {
      const extracted = normalizePaletteColors(
        await onExtract(sourcePhotoId),
      ).slice(0, 5);
      if (!openRef.current || sequence !== extractSequence.current) return;
      if (extracted.length < 2) {
        throw new Error("사진에서 서로 다른 대표 색상을 찾지 못했습니다.");
      }
      setMode("fixed");
      setColors(extracted);
    } catch (cause) {
      if (!openRef.current || sequence !== extractSequence.current) return;
      setError(
        designErrorMessage(cause, "사진에서 색상을 추출하지 못했습니다."),
      );
    } finally {
      if (sequence === extractSequence.current) setExtracting(false);
    }
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="색상"
      description="자동으로 맡기거나 디자인에 사용할 색상을 2~5개 지정하세요."
      size="medium"
      showCloseButton
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={extracting}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="submit"
            form={formId}
            width="full"
            disabled={extracting}
          >
            적용
          </Box>
        </HStack>
      }
    >
      <Box
        as="form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <VStack gap="x5" alignItems="stretch">
          <RadioGroup
            value={mode}
            onValueChange={chooseMode}
            aria-label="색상 지정 방식"
          >
            <RadioGroupItem
              value="auto"
              label="자동"
              description="프롬프트와 참고 사진에 맞춰 색상을 정해요."
            />
            <RadioGroupItem
              value="fixed"
              label="직접 선택"
              description="지정한 색상을 반드시 사용하는 팔레트를 만들어요."
            />
          </RadioGroup>

          {mode === "fixed" ? (
            <VStack gap="x3" alignItems="stretch">
              <HStack justify="space-between" align="center">
                <Text textStyle="label">적용 색상</Text>
                <ActionButton
                  type="button"
                  size="small"
                  variant="neutralWeak"
                  disabled={colors.length >= 5}
                  onClick={() => setColors((current) => [...current, ""])}
                >
                  <Icon svg={<PlusIcon />} size={16} />
                  색상 추가
                </ActionButton>
              </HStack>
              {colors.map((color, index) => (
                <HStack key={`${index}-${colors.length}`} gap="x2" align="end">
                  <Box
                    as="input"
                    type="color"
                    aria-label={`${index + 1}번째 색상 선택`}
                    value={normalizeHexColor(color) ?? PICKER_FALLBACK}
                    onChange={(event) => {
                      const value = event.currentTarget.value.toUpperCase();
                      setColors((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? value : item,
                        ),
                      );
                    }}
                    width={40}
                    height={40}
                    borderRadius="r2"
                    className="shrink-0 cursor-pointer overflow-hidden border border-stroke-neutral-weak bg-bg-layer-default p-0"
                  />
                  <Box flex={1}>
                    <TextField
                      label={`${index + 1}번째 HEX`}
                      placeholder="#RRGGBB"
                      autoComplete="off"
                      value={color}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setColors((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? value : item,
                          ),
                        );
                      }}
                    />
                  </Box>
                  <ActionButton
                    type="button"
                    size="medium"
                    variant="ghost"
                    iconOnly
                    aria-label={`${index + 1}번째 색상 삭제`}
                    onClick={() =>
                      setColors((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                  >
                    <Icon svg={<TrashIcon />} size={18} />
                  </ActionButton>
                </HStack>
              ))}
            </VStack>
          ) : null}

          {photos.length > 0 ? (
            <VStack gap="x3" alignItems="stretch">
              <Text textStyle="label">참고 사진에서 추출</Text>
              <RadioGroup
                value={sourcePhotoId}
                onValueChange={(photoId) => {
                  extractSequence.current += 1;
                  setExtracting(false);
                  setSourcePhotoId(photoId);
                  setError(null);
                }}
                aria-label="색상을 추출할 사진"
              >
                {photos.map((photo) => (
                  <RadioGroupItem
                    key={photo.id}
                    value={photo.id}
                    label={photo.name}
                  />
                ))}
              </RadioGroup>
              <ActionButton
                type="button"
                variant="neutralOutline"
                loading={extracting}
                disabled={!sourcePhotoId}
                onClick={() => void extract()}
              >
                대표 색상 추출
              </ActionButton>
            </VStack>
          ) : null}

          {error ? (
            <Callout
              tone="critical"
              title="색상 설정을 확인해 주세요"
              description={error}
            />
          ) : null}
        </VStack>
      </Box>
    </ResponsiveModal>
  );
}
