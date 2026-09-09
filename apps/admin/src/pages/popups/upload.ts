import {
  completeAdminPopupImageUpload,
  createAdminPopupImageUploadUrl,
  deleteAdminPopupImageUpload,
} from "@essesion/api-client";

// 상품 이미지 업로드(`pages/products/upload.ts`)의 복제 — 엔드포인트만 팝업용이다.
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;

export type PopupImageUploadResult = {
  uploadId: string;
  publicUrl: string;
};

function validateImage(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하로 선택해 주세요.");
  }
}

export async function uploadPopupImage(
  file: File,
): Promise<PopupImageUploadResult> {
  validateImage(file);
  const issued = await createAdminPopupImageUploadUrl({
    body: {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    },
    throwOnError: true,
  });
  const response = await fetch(issued.data.upload_url, {
    method: "PUT",
    headers: issued.data.required_headers,
    body: file,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("배너 이미지를 업로드하지 못했습니다.");
  const completed = await completeAdminPopupImageUpload({
    path: { upload_id: issued.data.upload_id },
    throwOnError: true,
  });
  return {
    uploadId: completed.data.upload_id,
    publicUrl: completed.data.public_url,
  };
}

export async function discardPopupImageUpload(uploadId: string) {
  try {
    await deleteAdminPopupImageUpload({
      path: { upload_id: uploadId },
      throwOnError: true,
    });
  } catch {
    // 저장과 제거가 경합하면 이미 팝업에 연결되었을 수 있다. 정리는 best effort — 24시간 TTL이 받는다.
  }
}
