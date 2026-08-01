import {
  ActionButton,
  AttachmentDisplayField,
  ResponsiveModal,
} from "@essesion/shared";

import {
  DESIGN_PHOTO_ACCEPT,
  MAX_DESIGN_PHOTOS,
} from "@/features/design/api/attachments";
import type { PhotoReference } from "@/features/design/model/use-photo-references";

export type PhotoReferenceModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photos: readonly PhotoReference[];
  onAddFiles: (files: File[]) => void;
  onRemove: (id: string) => void;
};

/** 참고 사진 — 첫 디자인을 만들 때 색감·분위기 참고로 함께 보낸다. */
export function PhotoReferenceModal({
  open,
  onOpenChange,
  photos,
  onAddFiles,
  onRemove,
}: PhotoReferenceModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="참고 사진"
      description="첫 디자인을 만들 때 색감·분위기 참고로 함께 보냅니다."
      showCloseButton
      footer={
        <ActionButton size="medium" onClick={() => onOpenChange(false)}>
          확인
        </ActionButton>
      }
    >
      <AttachmentDisplayField
        items={photos.map((photo) => ({
          id: photo.id,
          src: photo.previewUrl,
          alt: photo.name,
        }))}
        max={MAX_DESIGN_PHOTOS}
        accept={DESIGN_PHOTO_ACCEPT}
        addLabel="참고 사진 추가"
        onAddFiles={onAddFiles}
        onRemove={onRemove}
      />
    </ResponsiveModal>
  );
}
