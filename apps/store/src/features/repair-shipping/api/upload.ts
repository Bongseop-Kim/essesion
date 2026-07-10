import {
  createUploadUrl,
  registerRepairShippingUpload,
} from "@essesion/api-client";

export const MAX_REPAIR_PHOTO_BYTES = 10 * 1024 * 1024;
export const REPAIR_PHOTO_ACCEPT = "image/jpeg,image/png,image/webp";

/** 서명 PUT URL 3단계: 발급 → GCS PUT → 등록. 반환: object_key */
export async function uploadRepairShippingPhoto(file: File): Promise<string> {
  if (file.size <= 0 || file.size > MAX_REPAIR_PHOTO_BYTES) {
    throw new Error("사진은 10MB 이하로 선택해 주세요.");
  }
  if (!REPAIR_PHOTO_ACCEPT.split(",").includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }

  const issued = await createUploadUrl({
    body: {
      kind: "repair_shipping_upload",
      filename: file.name,
      content_type: file.type,
    },
  });
  if (!issued.data) throw new Error("사진 업로드를 준비하지 못했습니다.");

  if (issued.data.upload_required) {
    const response = await fetch(issued.data.upload_url, {
      method: "PUT",
      // 서명이 content_type을 포함하므로 반드시 동일 헤더로 PUT
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error("사진을 업로드하지 못했습니다.");
  }

  const registered = await registerRepairShippingUpload({
    body: { object_key: issued.data.object_key },
  });
  if (!registered.data) throw new Error("사진 업로드를 확인하지 못했습니다.");
  return issued.data.object_key;
}
