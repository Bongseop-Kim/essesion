import type { ReformImageIn } from "@essesion/api-client";
import {
  createReformUploadUrl,
  registerReformUpload,
} from "@essesion/api-client";

export const MAX_REFORM_IMAGE_BYTES = 10 * 1024 * 1024;
export const REFORM_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

export async function uploadReformImage(file: File): Promise<ReformImageIn> {
  if (file.size <= 0 || file.size > MAX_REFORM_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하로 선택해 주세요.");
  }
  if (!REFORM_IMAGE_ACCEPT.split(",").includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }

  const issued = await createReformUploadUrl({
    body: {
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
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
