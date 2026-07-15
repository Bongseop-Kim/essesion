import {
  completeAdminProductImageUpload,
  createAdminProductImageUploadUrl,
  deleteAdminProductImageUpload,
} from "@essesion/api-client";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;

export type ProductImageUploadResult = {
  uploadId: string;
  publicUrl: string;
};

function validateProductImage(file: File) {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하로 선택해 주세요.");
  }
}

export async function uploadProductImage(
  file: File,
  kind: "primary" | "detail",
): Promise<ProductImageUploadResult> {
  validateProductImage(file);
  const issued = await createAdminProductImageUploadUrl({
    body: {
      kind,
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    },
    throwOnError: true,
  });
  if (issued.data.upload_required) {
    const response = await fetch(issued.data.upload_url, {
      method: "PUT",
      headers: issued.data.required_headers,
      body: file,
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error("상품 이미지를 업로드하지 못했습니다.");
  }
  const completed = await completeAdminProductImageUpload({
    path: { upload_id: issued.data.upload_id },
    throwOnError: true,
  });
  return {
    uploadId: completed.data.upload_id,
    publicUrl: completed.data.public_url,
  };
}

export async function discardProductImageUpload(uploadId: string) {
  try {
    await deleteAdminProductImageUpload({
      path: { upload_id: uploadId },
      throwOnError: true,
    });
  } catch {
    // 저장 확정과 제거가 경합하면 이미 상품에 연결되었을 수 있다. 정리는 best effort다.
  }
}
