import {
  createUploadUrl,
  registerRepairShippingUpload,
} from "@essesion/api-client";

import { putToSignedUrl, validateImageFile } from "@/shared/lib/upload";

export {
  IMAGE_ACCEPT as REPAIR_PHOTO_ACCEPT,
  MAX_IMAGE_BYTES as MAX_REPAIR_PHOTO_BYTES,
} from "@/shared/lib/upload";

/** 서명 PUT URL 3단계: 발급 → GCS PUT → 등록. 반환: object_key */
export async function uploadRepairShippingPhoto(file: File): Promise<string> {
  validateImageFile(file, "사진은 10MB 이하로 선택해 주세요.");

  const issued = await createUploadUrl({
    body: {
      kind: "repair_shipping_upload",
      filename: file.name,
      content_type: file.type,
    },
  });
  if (!issued.data) throw new Error("사진 업로드를 준비하지 못했습니다.");

  if (issued.data.upload_required) {
    // 서명이 content_type을 포함하므로 반드시 동일 헤더로 PUT
    await putToSignedUrl(
      issued.data.upload_url,
      { "Content-Type": file.type },
      file,
      "사진을 업로드하지 못했습니다.",
    );
  }

  const registered = await registerRepairShippingUpload({
    body: { object_key: issued.data.object_key },
  });
  if (!registered.data) throw new Error("사진 업로드를 확인하지 못했습니다.");
  return issued.data.object_key;
}
