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

export async function previewPhotoMotif(input: {
  uploadId: string;
  removeBackground: boolean;
}) {
  const response = await previewPhotoMotifRequest({
    body: {
      upload_id: input.uploadId,
      remove_background: input.removeBackground,
    },
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
