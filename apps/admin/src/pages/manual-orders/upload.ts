import { createManualOrderImageUploadUrl } from "@essesion/api-client";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 120_000;

export const MAX_MANUAL_ORDER_IMAGES = 5;
export const MANUAL_ORDER_IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(",");

// 별도 complete 호출은 없다 — 저장(링크) 시점에 서버가 객체 메타데이터를 검증한다.
export async function uploadManualOrderImage(file: File): Promise<string> {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error("이미지는 10MB 이하로 선택해 주세요.");
  }
  const issued = await createManualOrderImageUploadUrl({
    body: { content_type: file.type, size_bytes: file.size },
    throwOnError: true,
  });
  const response = await fetch(issued.data.upload_url, {
    method: "PUT",
    headers: issued.data.required_headers,
    body: file,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("첨부 이미지를 업로드하지 못했습니다.");
  return issued.data.upload_id;
}
