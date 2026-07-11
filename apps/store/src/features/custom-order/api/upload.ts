import type { ReferenceImageIn, UploadUrlRequest } from "@essesion/api-client";
import { createUploadUrl } from "@essesion/api-client";

import { putToSignedUrl, validateImageFile } from "@/shared/lib/upload";

export { IMAGE_ACCEPT as CUSTOM_IMAGE_ACCEPT } from "@/shared/lib/upload";

export async function uploadOrderImage(
  file: File,
  kind: UploadUrlRequest["kind"],
): Promise<ReferenceImageIn> {
  validateImageFile(file);
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
    await putToSignedUrl(
      issued.data.upload_url,
      issued.data.required_headers,
      file,
    );
  }
  return { object_key: issued.data.object_key };
}
