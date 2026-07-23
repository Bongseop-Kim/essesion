import type { ReformImageIn } from "@essesion/api-client";
import {
  createReformUploadUrl,
  registerReformUpload,
} from "@essesion/api-client";

import { putIfRequired, validateImageFile } from "@/shared/lib/upload";

export { IMAGE_ACCEPT as REFORM_IMAGE_ACCEPT } from "@/shared/lib/upload";

export async function uploadReformImage(file: File): Promise<ReformImageIn> {
  validateImageFile(file);

  const issued = await createReformUploadUrl({
    body: {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    },
  });
  if (!issued.data) throw new Error("이미지 업로드를 준비하지 못했습니다.");

  await putIfRequired(issued.data, file);

  const completed = await registerReformUpload({
    body: {
      object_key: issued.data.object_key,
      claim_token: issued.data.claim_token,
      size_bytes: file.size,
    },
  });
  if (!completed.data) throw new Error("이미지 업로드를 확인하지 못했습니다.");
  return {
    object_key: issued.data.object_key,
    claim_token: issued.data.claim_token,
  };
}
