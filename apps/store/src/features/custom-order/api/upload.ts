import type {
  OrderReferenceImageIn,
  ReferenceImageIn,
  UploadUrlRequest,
} from "@essesion/api-client";
import { completeOrderImage, createUploadUrl } from "@essesion/api-client";

import { putIfRequired, validateImageFile } from "@/shared/lib/upload";

export { IMAGE_ACCEPT as CUSTOM_IMAGE_ACCEPT } from "@/shared/lib/upload";

type OrderUploadKind = Extract<
  UploadUrlRequest["kind"],
  "custom_order" | "sample_order"
>;

export function uploadOrderImage(
  file: File,
  kind: OrderUploadKind,
): Promise<OrderReferenceImageIn>;
export function uploadOrderImage(
  file: File,
  kind: "quote_request",
): Promise<ReferenceImageIn>;
export async function uploadOrderImage(
  file: File,
  kind: OrderUploadKind | "quote_request",
): Promise<OrderReferenceImageIn | ReferenceImageIn> {
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
  await putIfRequired(issued.data, file);
  if (kind !== "quote_request") {
    if (!issued.data.upload_id)
      throw new Error("이미지 업로드 식별자를 확인하지 못했습니다.");
    const completed = await completeOrderImage({
      path: { upload_id: issued.data.upload_id },
    });
    if (!completed.data)
      throw new Error("이미지 업로드를 확인하지 못했습니다.");
    return { upload_id: completed.data.upload_id };
  }
  return { object_key: issued.data.object_key };
}
