import {
  completeReviewPhotoUpload,
  createReviewPhotoUploadUrl,
} from "@essesion/api-client";

import { putIfRequired, validateImageFile } from "@/shared/lib/upload";

export { IMAGE_ACCEPT as REVIEW_PHOTO_ACCEPT } from "@/shared/lib/upload";

export const MAX_REVIEW_PHOTOS = 5;

/** 서명 PUT URL 3단계: 발급 → GCS PUT → 완료. 반환: upload_id */
export async function uploadReviewPhoto(file: File): Promise<string> {
  validateImageFile(file, "사진은 10MB 이하로 선택해 주세요.");

  const issued = await createReviewPhotoUploadUrl({
    body: {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    },
  });
  if (!issued.data) throw new Error("사진 업로드를 준비하지 못했습니다.");

  await putIfRequired(issued.data, file, "사진을 업로드하지 못했습니다.");

  const completed = await completeReviewPhotoUpload({
    path: { upload_id: issued.data.upload_id },
  });
  if (!completed.data) throw new Error("사진 업로드를 확인하지 못했습니다.");
  return completed.data.upload_id;
}
