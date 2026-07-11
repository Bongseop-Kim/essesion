import type { ReformImageIn } from "@essesion/api-client";
import {
  createReformUploadUrl,
  registerReformUpload,
} from "@essesion/api-client";

import { putToSignedUrl, validateImageFile } from "@/shared/lib/upload";

export {
  IMAGE_ACCEPT as REFORM_IMAGE_ACCEPT,
  MAX_IMAGE_BYTES as MAX_REFORM_IMAGE_BYTES,
} from "@/shared/lib/upload";

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

  if (issued.data.upload_required) {
    await putToSignedUrl(
      issued.data.upload_url,
      issued.data.required_headers,
      file,
    );
  }

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

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex++;
        results[index] = await mapper(values[index] as T);
      }
    },
  );
  await Promise.all(workers);
  return results;
}
