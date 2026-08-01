import { snackbar } from "@essesion/shared";
import { useEffect, useRef, useState } from "react";

import {
  MAX_DESIGN_PHOTOS,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import { validateImageFile } from "@/shared/lib/upload";

import type { DesignReferenceImage } from "./draft";

export type PhotoReference = {
  id: string;
  name: string;
  previewUrl: string;
  file: File;
  /** 업로드는 첫 전송 때 한 번만 — 실패한 요청을 재시도해도 다시 올리지 않는다. */
  uploadId?: string;
};

/**
 * 참고 사진 첨부 — 첫 디자인을 만들 때만 함께 보낼 수 있다(커밋된 디자인에는 서버가 422).
 * 목적(purpose)은 서버 자동 판단에 맡긴다: 모티프 정체성은 모티프 패널이, 색은 색 지정이 담당한다.
 */
export function usePhotoReferences() {
  const [photos, setPhotos] = useState<PhotoReference[]>([]);
  const current = useRef<PhotoReference[]>([]);
  current.current = photos;

  useEffect(
    () => () => {
      for (const photo of current.current)
        URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

  const add = (files: File[]) => {
    if (files.length > MAX_DESIGN_PHOTOS - current.current.length) {
      snackbar(`참고 사진은 최대 ${MAX_DESIGN_PHOTOS}장까지 첨부할 수 있어요.`);
    }
    const accepted: PhotoReference[] = [];
    for (const file of files) {
      try {
        validateImageFile(file, "사진은 장당 10MB 이하로 선택해 주세요.");
        accepted.push({
          id: globalThis.crypto.randomUUID(),
          name: file.name,
          previewUrl: URL.createObjectURL(file),
          file,
        });
      } catch (error) {
        snackbar(
          error instanceof Error ? error.message : "사진을 확인해 주세요.",
        );
      }
    }
    if (accepted.length > 0)
      // 한도 판정은 updater 안에서 — 동시 호출이 겹쳐도 최대 장수를 넘지 않는다.
      setPhotos((items) => {
        const kept = accepted.slice(
          0,
          Math.max(0, MAX_DESIGN_PHOTOS - items.length),
        );
        for (const dropped of accepted.slice(kept.length))
          URL.revokeObjectURL(dropped.previewUrl);
        return [...items, ...kept];
      });
  };

  const remove = (id: string) => {
    const photo = current.current.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhotos((items) => items.filter((item) => item.id !== id));
  };

  const clear = () => {
    for (const photo of current.current) URL.revokeObjectURL(photo.previewUrl);
    setPhotos([]);
  };

  // state 객체를 직접 변형하지 않기 위한 캐시 — 재렌더 전에도 값을 쓸 수 있다.
  const uploadIds = useRef(new Map<string, string>());

  const ensureUploaded = async (photo: PhotoReference) => {
    const cached = photo.uploadId ?? uploadIds.current.get(photo.id);
    if (cached) return cached;
    const uploadId = await uploadDesignPhoto(photo.file);
    uploadIds.current.set(photo.id, uploadId);
    setPhotos((items) =>
      items.map((item) =>
        item.id === photo.id ? { ...item, uploadId } : item,
      ),
    );
    return uploadId;
  };

  return {
    photos,
    add,
    remove,
    clear,
    /** 색 지정 모달이 사진에서 팔레트를 뽑을 때 쓴다. */
    async uploadIdOf(id: string) {
      const photo = current.current.find((item) => item.id === id);
      if (!photo) throw new Error("첨부한 사진을 찾지 못했습니다.");
      return ensureUploaded(photo);
    },
    async referenceImages(): Promise<DesignReferenceImage[]> {
      const references: DesignReferenceImage[] = [];
      for (const photo of current.current) {
        references.push({
          uploadId: await ensureUploaded(photo),
          purpose: "auto",
        });
      }
      return references;
    },
  };
}
