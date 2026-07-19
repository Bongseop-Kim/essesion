import {
  ActionButton,
  Box,
  Callout,
  Chip,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useId } from "react";

export type ExportFormat = "png" | "tiff";
export type ExportDpi = 150 | 300 | 600;

export type ExportDialogValue = {
  format: ExportFormat;
  dpi: ExportDpi;
  widthMm: number;
};

export type ExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  format: ExportFormat;
  dpi: ExportDpi;
  widthMm: string;
  onFormatChange: (format: ExportFormat) => void;
  onDpiChange: (dpi: ExportDpi) => void;
  onWidthMmChange: (widthMm: string) => void;
  onSubmit: (value: ExportDialogValue) => void;
  loading?: boolean;
  disabled?: boolean;
};

const DPI_OPTIONS: readonly ExportDpi[] = [150, 300, 600];

export function ExportDialog({
  open,
  onOpenChange,
  format,
  dpi,
  widthMm,
  onFormatChange,
  onDpiChange,
  onWidthMmChange,
  onSubmit,
  loading = false,
  disabled = false,
}: ExportDialogProps) {
  const formId = useId();
  const numericWidth = Number(widthMm);
  const validWidth =
    widthMm.trim() !== "" && Number.isFinite(numericWidth) && numericWidth > 0;

  const submit = () => {
    if (!validWidth || disabled || loading) return;
    onSubmit({ format, dpi, widthMm: numericWidth });
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="디자인 내려받기"
      description="인쇄에 맞는 파일 형식과 해상도를 선택해 주세요."
      size="medium"
      showCloseButton
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="submit"
            form={formId}
            width="full"
            loading={loading}
            disabled={disabled || !validWidth}
          >
            파일 만들기
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
          <VStack gap="x2" alignItems="stretch">
            <Text textStyle="label">파일 형식</Text>
            <SelectBox
              value={format}
              onValueChange={(value) => onFormatChange(value as ExportFormat)}
              columns={2}
              aria-label="파일 형식"
            >
              <SelectBoxItem
                value="png"
                label="PNG"
                description="웹과 일반 인쇄에 적합"
                disabled={disabled || loading}
              />
              <SelectBoxItem
                value="tiff"
                label="TIFF"
                description="고품질 인쇄 원본에 적합"
                disabled={disabled || loading}
              />
            </SelectBox>
          </VStack>

          <VStack gap="x2" alignItems="stretch">
            <Text textStyle="label">해상도</Text>
            <HStack gap="x2" role="group" aria-label="해상도">
              {DPI_OPTIONS.map((option) => (
                <Chip
                  key={option}
                  selected={dpi === option}
                  disabled={disabled || loading}
                  onClick={() => onDpiChange(option)}
                  aria-label={`${option} DPI`}
                >
                  {option} DPI
                </Chip>
              ))}
            </HStack>
          </VStack>

          <TextField
            type="number"
            inputMode="decimal"
            min="1"
            step="0.1"
            label="출력 폭"
            description="실제 인쇄할 디자인의 가로 폭을 입력해 주세요."
            suffix="mm"
            value={widthMm}
            onChange={(event) => onWidthMmChange(event.currentTarget.value)}
            errorMessage={
              widthMm.trim() !== "" && !validWidth
                ? "0보다 큰 값을 입력해 주세요."
                : undefined
            }
            disabled={disabled || loading}
          />

          <Callout
            tone="neutral"
            title="무료 내려받기"
            description="PNG와 TIFF 내려받기는 토큰을 사용하지 않아요."
          />
        </VStack>
      </Box>
    </ResponsiveModal>
  );
}
