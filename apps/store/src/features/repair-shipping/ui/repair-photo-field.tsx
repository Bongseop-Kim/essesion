import { createReadUrl } from "@essesion/api-client";
import { AttachmentDisplayField } from "@essesion/shared";
import { useQueries } from "@tanstack/react-query";

import { usePhotoUploadQueue } from "@/shared/lib/use-photo-upload-queue";
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
  const { pendingCount, addFiles, removeItem } =
    usePhotoUploadQueue<RepairPhotoState>({
      photos,
      max: MAX_REPAIR_PHOTOS,
      upload: async (file) => ({
        objectKey: await uploadRepairShippingPhoto(file),
        previewUrl: URL.createObjectURL(file),
      }),
      getId: (photo) => photo.objectKey,
      getPreview: (photo) => photo.previewUrl,
      onChange,
      onUploadingChange,
    });

  // 세션 복원 항목(previewUrl === null)은 read-url로 썸네일을 되살린다.
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
      onAddFiles={disabled ? undefined : (files) => void addFiles(files)}
      onRemove={disabled ? undefined : removeItem}
    />
  );
}
