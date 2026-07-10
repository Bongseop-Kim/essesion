import { createReadUrl } from "@essesion/api-client";
import { AttachmentDisplayField, snackbar } from "@essesion/shared";
import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { mapWithConcurrency } from "@/features/reform";
import { REPAIR_PHOTO_ACCEPT, uploadRepairShippingPhoto } from "../api/upload";
import { MAX_REPAIR_PHOTOS, type RepairPhotoState } from "../model/shipment";

/** 발송 사진 첨부 — 선택 즉시 업로드(object_key 확보), 세션 복원 항목은 read-url로 썸네일 표시 */
export function RepairPhotoField({
  photos,
  onChange,
  onUploadingChange,
  disabled,
}: {
  photos: RepairPhotoState[];
  onChange: (next: RepairPhotoState[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  disabled?: boolean;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  // 비동기 업로드 완료 시점의 최신 photos를 참조하기 위한 미러
  const photosRef = useRef(photos);
  photosRef.current = photos;

  useEffect(() => {
    onUploadingChange?.(pendingCount > 0);
  }, [onUploadingChange, pendingCount]);

  const restoreTargets = photos.filter((photo) => photo.previewUrl === null);
  const restoreQueries = useQueries({
    queries: restoreTargets.map((photo) => ({
      queryKey: ["repair-shipping-photo", photo.objectKey],
      queryFn: async () => {
        const response = await createReadUrl({
          body: { object_key: photo.objectKey },
        });
        if (!response.data) throw new Error("사진을 불러오지 못했습니다.");
        return response.data.read_url;
      },
      staleTime: 10 * 60 * 1000,
    })),
  });
  const restored = new Map<string, string>();
  restoreTargets.forEach((photo, index) => {
    const url = restoreQueries[index]?.data;
    if (url) restored.set(photo.objectKey, url);
  });

  const handleAddFiles = async (files: File[]) => {
    const remaining =
      MAX_REPAIR_PHOTOS - photosRef.current.length - pendingCount;
    const accepted = files.slice(0, Math.max(0, remaining));
    if (accepted.length === 0) return;
    setPendingCount((count) => count + accepted.length);
    await mapWithConcurrency(accepted, 2, async (file) => {
      try {
        const objectKey = await uploadRepairShippingPhoto(file);
        const next = [
          ...photosRef.current,
          { objectKey, previewUrl: URL.createObjectURL(file) },
        ];
        photosRef.current = next;
        onChange(next);
      } catch (error) {
        snackbar(
          error instanceof Error
            ? error.message
            : "사진을 업로드하지 못했습니다.",
        );
      } finally {
        setPendingCount((count) => count - 1);
      }
    });
  };

  const handleRemove = (id: string) => {
    const target = photosRef.current.find((photo) => photo.objectKey === id);
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    const next = photosRef.current.filter((photo) => photo.objectKey !== id);
    photosRef.current = next;
    onChange(next);
  };

  return (
    <AttachmentDisplayField
      label="발송 사진"
      description={pendingCount > 0 ? "사진을 업로드하는 중입니다." : undefined}
      max={MAX_REPAIR_PHOTOS}
      accept={REPAIR_PHOTO_ACCEPT}
      addLabel="사진 추가"
      items={photos.map((photo, index) => ({
        id: photo.objectKey,
        src: photo.previewUrl ?? restored.get(photo.objectKey) ?? "",
        alt: `발송 사진 ${index + 1}`,
      }))}
      onAddFiles={disabled ? undefined : (files) => void handleAddFiles(files)}
      onRemove={disabled ? undefined : handleRemove}
    />
  );
}
