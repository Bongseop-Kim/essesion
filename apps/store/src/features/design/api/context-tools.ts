import { previewPhotoMotif as previewPhotoMotifRequest } from "@essesion/api-client";

/** 배경은 항상 지운다 — 배경이 남은 모티프는 넥타이 패턴이 될 수 없다(선택 옵션 없음). */
export async function previewPhotoMotif(input: { uploadId: string }) {
  const response = await previewPhotoMotifRequest({
    body: { upload_id: input.uploadId },
    throwOnError: true,
  });
  return {
    ...response.data,
    warnings: response.data.warnings ?? [],
    background_confidence: response.data.background_confidence ?? null,
  };
}
