export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export function validateImageFile(
  file: File,
  sizeError = "이미지는 10MB 이하로 선택해 주세요.",
): void {
  if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error(sizeError);
  }
  if (!IMAGE_ACCEPT.split(",").includes(file.type)) {
    throw new Error("JPG, PNG, WebP 이미지만 업로드할 수 있습니다.");
  }
}

// 최대 10MB를 느린 모바일 회선으로 올릴 여유
const UPLOAD_TIMEOUT_MS = 120_000;

/** 서명 URL 발급 응답을 그대로 GCS로 PUT한다(모든 업로드 플로우 공통 단계). */
export async function putIssued(
  issued: { upload_url: string; required_headers?: HeadersInit },
  file: File,
  uploadError = "이미지를 업로드하지 못했습니다.",
): Promise<void> {
  const response = await fetch(issued.upload_url, {
    method: "PUT",
    headers: issued.required_headers,
    body: file,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(uploadError);
}
