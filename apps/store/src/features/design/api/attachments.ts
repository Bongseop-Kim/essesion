import {
  completeDesignReferenceUpload,
  createUploadUrl,
  importUserMotif,
  type UserMotifOut,
} from "@essesion/api-client";

import { putToSignedUrl, validateImageFile } from "@/shared/lib/upload";

export { IMAGE_ACCEPT as DESIGN_PHOTO_ACCEPT } from "@/shared/lib/upload";

export const DESIGN_SVG_ACCEPT = ".svg,image/svg+xml";
export const MAX_DESIGN_PHOTOS = 5;
export const MAX_DESIGN_MOTIFS = 2;
export const MAX_DESIGN_SVG_BYTES = 2 * 1024 * 1024;

export async function uploadDesignPhoto(file: File): Promise<string> {
  validateImageFile(file, "사진은 장당 10MB 이하로 선택해 주세요.");
  const issued = await createUploadUrl({
    body: {
      kind: "design_reference",
      filename: file.name,
      content_type: file.type,
      size_bytes: file.size,
    },
    throwOnError: true,
  });
  if (issued.data.upload_required) {
    await putToSignedUrl(
      issued.data.upload_url,
      issued.data.required_headers,
      file,
      "참고 사진을 업로드하지 못했습니다.",
    );
  }
  const completed = await completeDesignReferenceUpload({
    path: { upload_id: issued.data.upload_id },
    throwOnError: true,
  });
  return completed.data.upload_id;
}

export async function importDesignMotif(file: File): Promise<UserMotifOut> {
  if (file.size <= 0 || file.size > MAX_DESIGN_SVG_BYTES) {
    throw new Error("SVG는 파일당 2MB 이하로 선택해 주세요.");
  }
  if (
    file.type !== "image/svg+xml" &&
    !file.name.toLocaleLowerCase().endsWith(".svg")
  ) {
    throw new Error("SVG 파일만 첨부할 수 있습니다.");
  }
  const svg = await file.text();
  const response = await importUserMotif({
    body: {
      name: file.name.replace(/\.svg$/i, "").slice(0, 100),
      svg,
    },
    throwOnError: true,
  });
  return response.data;
}
