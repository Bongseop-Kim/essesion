import {
  createDesignIdeas as createDesignIdeasRequest,
  extractDesignPalette as extractDesignPaletteRequest,
  previewPhotoMotif as previewPhotoMotifRequest,
  previewTextMotif as previewTextMotifRequest,
} from "@essesion/api-client";

import type {
  DesignPalette,
  DesignPatternConstraints,
  DesignReferenceImage,
} from "@/features/design/model/draft";

type IdeaContext = {
  prompt: string;
  referenceImages: DesignReferenceImage[];
  userMotifIds: string[];
  palette: DesignPalette;
  patternConstraints: DesignPatternConstraints;
};

export async function extractDesignPalette(uploadId: string, colorCount = 5) {
  const response = await extractDesignPaletteRequest({
    body: { upload_id: uploadId, color_count: colorCount },
    throwOnError: true,
  });
  return response.data.colors;
}

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
  simplification: "low" | "medium" | "high";
  colorCount: number;
}) {
  const response = await previewPhotoMotifRequest({
    body: {
      upload_id: input.uploadId,
      remove_background: input.removeBackground,
      simplification: input.simplification,
      color_count: input.colorCount,
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
      reference_images: context.referenceImages.map((image) => ({
        upload_id: image.uploadId,
        purpose: image.purpose,
      })),
      user_motif_ids: context.userMotifIds,
      palette: context.palette,
      pattern_constraints: {
        motif_scale: context.patternConstraints.motifScale,
        density: context.patternConstraints.density,
        arrangement: context.patternConstraints.arrangement,
        direction: context.patternConstraints.direction,
      },
      count: 4,
    },
    throwOnError: true,
  });
  return response.data.ideas;
}
