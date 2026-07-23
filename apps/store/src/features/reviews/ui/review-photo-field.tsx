import { AttachmentDisplayField } from "@essesion/shared";

import { usePhotoUploadQueue } from "@/shared/lib/use-photo-upload-queue";
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_PHOTO_ACCEPT,
  uploadReviewPhoto,
} from "../api/upload";

export type ReviewPhotoState = {
  uploadId: string;
  /** 새 업로드는 objectURL, 기존 사진은 공개 assets URL */
  src: string;
};

/** 후기 사진 첨부 — 선택 즉시 업로드(upload_id 확보), 최대 5장 */
export function ReviewPhotoField({
  photos,
  onChange,
  onUploadingChange,
  disabled,
}: {
  photos: ReviewPhotoState[];
  onChange: (next: ReviewPhotoState[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  // 부모(후기 모달)는 리마운트 전에 photos를 리셋하므로 언마운트 시 blob을 해제한다.
  const { pendingCount, addFiles, removeItem } =
    usePhotoUploadQueue<ReviewPhotoState>({
      photos,
      max: MAX_REVIEW_PHOTOS,
      upload: async (file) => ({
        uploadId: await uploadReviewPhoto(file),
        src: URL.createObjectURL(file),
      }),
      getId: (photo) => photo.uploadId,
      getPreview: (photo) => photo.src,
      onChange,
      onUploadingChange,
      revokeBlobsOnUnmount: true,
    });

  return (
    <AttachmentDisplayField
      label="사진 (선택)"
      description={pendingCount > 0 ? "사진을 업로드하는 중입니다." : undefined}
      max={MAX_REVIEW_PHOTOS}
      accept={REVIEW_PHOTO_ACCEPT}
      addLabel="사진 추가"
      items={photos.map((photo, index) => ({
        id: photo.uploadId,
        src: photo.src,
        alt: `후기 사진 ${index + 1}`,
      }))}
      onAddFiles={disabled ? undefined : (files) => void addFiles(files)}
      onRemove={disabled ? undefined : removeItem}
    />
  );
}
