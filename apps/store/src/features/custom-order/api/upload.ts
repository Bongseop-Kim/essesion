import type { ReferenceImageIn, UploadUrlRequest } from "@essesion/api-client";
import { createUploadUrl } from "@essesion/api-client";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const CUSTOM_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export async function uploadOrderImage(
  file: File,
  kind: UploadUrlRequest["kind"],
): Promise<ReferenceImageIn> {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하로 선택해 주세요.");
  }
  if (!CUSTOM_IMAGE_ACCEPT.split(",").includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }
  const issued = await createUploadUrl({
    body: {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
      kind,
    },
  });
  if (!issued.data) throw new Error("이미지 업로드를 준비하지 못했습니다.");
  if (issued.data.upload_required) {
    const response = await fetch(issued.data.upload_url, {
      method: "PUT",
      headers: issued.data.required_headers,
      body: file,
    });
    if (!response.ok) throw new Error("이미지를 업로드하지 못했습니다.");
  }
  return { object_key: issued.data.object_key };
}
