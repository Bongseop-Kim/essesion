import {
  createDesignIdeas as createDesignIdeasRequest,
  previewPhotoMotif as previewPhotoMotifRequest,
  previewTextMotif as previewTextMotifRequest,
} from "@essesion/api-client";

type IdeaContext = {
  prompt: string;
  userMotifIds: string[];
};

export async function previewTextMotif(input: {
  text: string;
  fontId: "nanum-gothic" | "nanum-myeongjo";
  fontWeight: 400 | 700;
  letterSpacing: number;
}) {
  const response = await previewTextMotifRequest({
    body: {
      text: input.text,
      font_id: input.fontId,
      font_weight: input.fontWeight,
      letter_spacing: input.letterSpacing,
    },
    throwOnError: true,
  });
  return {
    ...response.data,
    warnings: response.data.warnings ?? [],
    background_confidence: response.data.background_confidence ?? null,
  };
}

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

export async function createDesignIdeas(context: IdeaContext) {
  const response = await createDesignIdeasRequest({
    body: {
      prompt: context.prompt,
      user_motif_ids: context.userMotifIds,
      count: 4,
    },
    throwOnError: true,
  });
  return response.data.ideas;
}
