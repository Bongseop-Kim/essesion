import { AttachmentDisplayField, snackbar } from "@essesion/shared";
import { useEffect, useRef, useState } from "react";

import { mapWithConcurrency } from "@/features/reform";

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
  const [pendingCount, setPendingCount] = useState(0);
  // 비동기 업로드 완료 시점의 최신 photos를 참조하기 위한 미러
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const mountedRef = useRef(true);

  useEffect(() => {
    onUploadingChange?.(pendingCount > 0);
  }, [onUploadingChange, pendingCount]);

  // 언마운트 후 늦게 끝난 업로드가 상태를 만지지 않게 하고, 남은 미리보기
  // blob URL을 해제한다 — 부모는 리마운트 전에 항상 photos를 리셋한다.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      for (const photo of photosRef.current) {
        if (photo.src.startsWith("blob:")) URL.revokeObjectURL(photo.src);
      }
    };
  }, []);

  const handleAddFiles = async (files: File[]) => {
    const remaining =
      MAX_REVIEW_PHOTOS - photosRef.current.length - pendingCount;
    const accepted = files.slice(0, Math.max(0, remaining));
    if (accepted.length === 0) return;
    setPendingCount((count) => count + accepted.length);
    await mapWithConcurrency(accepted, 2, async (file) => {
      try {
        const uploadId = await uploadReviewPhoto(file);
        if (!mountedRef.current) return;
        const next = [
          ...photosRef.current,
          { uploadId, src: URL.createObjectURL(file) },
        ];
        photosRef.current = next;
        onChange(next);
      } catch (error) {
        if (!mountedRef.current) return;
        snackbar(
          error instanceof Error
            ? error.message
            : "사진을 업로드하지 못했습니다.",
        );
      } finally {
        if (mountedRef.current) setPendingCount((count) => count - 1);
      }
    });
  };

  const handleRemove = (id: string) => {
    const target = photosRef.current.find((photo) => photo.uploadId === id);
    if (target?.src.startsWith("blob:")) URL.revokeObjectURL(target.src);
    const next = photosRef.current.filter((photo) => photo.uploadId !== id);
    photosRef.current = next;
    onChange(next);
  };

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
      onAddFiles={disabled ? undefined : (files) => void handleAddFiles(files)}
      onRemove={disabled ? undefined : handleRemove}
    />
  );
}
