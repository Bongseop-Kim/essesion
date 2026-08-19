import {
  ActionButton,
  Box,
  type DesignPreviewMode,
  Modal,
  SelectBox,
  SelectBoxItem,
} from "@essesion/shared";
import { useId, useState } from "react";

export type ExportDialogValue = {
  mode: DesignPreviewMode;
};

export type ExportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: ExportDialogValue) => void;
  loading?: boolean;
  disabled?: boolean;
};

/** 내려받을 모습(넥타이/타일)은 다이얼로그 로컬 폼 상태다. 형식·해상도는 고정. */
export function ExportDialog({
  open,
  onOpenChange,
  onSubmit,
  loading = false,
  disabled = false,
}: ExportDialogProps) {
  const formId = useId();
  const [mode, onModeChange] = useState<DesignPreviewMode>("tie");

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="디자인 내려받기"
      description="어떤 모습으로 내려받을지 선택해 주세요."
      size="medium"
      showCloseButton
      footer={
        <Box
          as={ActionButton}
          type="submit"
          form={formId}
          width="full"
          loading={loading}
          disabled={disabled}
        >
          파일 만들기
        </Box>
      }
    >
      <Box
        as="form"
        id={formId}
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || loading) return;
          onSubmit({ mode });
        }}
      >
        <SelectBox
          value={mode}
          onValueChange={(value) => onModeChange(value as DesignPreviewMode)}
          columns={2}
          aria-label="내려받을 모습"
        >
          <SelectBoxItem
            value="tie"
            label="넥타이"
            description="넥타이에 적용한 모습"
            disabled={disabled || loading}
          />
          <SelectBoxItem
            value="repeat"
            label="타일"
            description="이어붙일 수 있는 타일 원본"
            disabled={disabled || loading}
          />
        </SelectBox>
      </Box>
    </Modal>
  );
}
