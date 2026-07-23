import { snackbar } from "@essesion/shared";
import { useEffect, useRef, useState } from "react";

import { mapWithConcurrency } from "@/shared/lib/async";

/**
 * 사진 첨부 업로드 큐 — 선택 즉시 병렬(최대 2)로 업로드하고 완료분을 순차 반영한다.
 * 항목 형태는 제네릭 T. 언마운트 후 늦게 끝난 업로드는 무시한다.
 * `revokeBlobsOnUnmount`: 부모가 리마운트 전에 photos를 리셋하는 경우에만 켠다
 * (blob 미리보기가 언마운트 후에도 유지돼야 하면 끈다).
 */
export function usePhotoUploadQueue<T>({
  photos,
  max,
  upload,
  getId,
  getPreview,
  onChange,
  onUploadingChange,
  revokeBlobsOnUnmount = false,
}: {
  photos: T[];
  max: number;
  /** 파일 하나를 업로드하고 목록에 추가할 항목을 만든다(objectURL 생성 포함). */
  upload: (file: File) => Promise<T>;
  getId: (item: T) => string;
  /** blob 미리보기 URL(해제 대상). 없으면 null. */
  getPreview: (item: T) => string | null;
  onChange: (next: T[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
  revokeBlobsOnUnmount?: boolean;
}) {
  const [pendingCount, setPendingCount] = useState(0);
  // 비동기 완료 시점의 최신 photos를 참조하기 위한 미러
  const photosRef = useRef(photos);
  photosRef.current = photos;
  const mountedRef = useRef(true);
  const getPreviewRef = useRef(getPreview);
  getPreviewRef.current = getPreview;

  useEffect(() => {
    onUploadingChange?.(pendingCount > 0);
  }, [onUploadingChange, pendingCount]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (!revokeBlobsOnUnmount) return;
      for (const item of photosRef.current) {
        const preview = getPreviewRef.current(item);
        if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
      }
    };
  }, [revokeBlobsOnUnmount]);

  const addFiles = async (files: File[]) => {
    const remaining = max - photosRef.current.length - pendingCount;
    const accepted = files.slice(0, Math.max(0, remaining));
    if (accepted.length === 0) return;
    setPendingCount((count) => count + accepted.length);
    await mapWithConcurrency(accepted, 2, async (file) => {
      try {
        const item = await upload(file);
        if (!mountedRef.current) return;
        const next = [...photosRef.current, item];
        photosRef.current = next;
        onChange(next);
      } catch (error) {
        if (!mountedRef.current) return;
        snackbar(
          error instanceof Error
            ? error.message
            : "사진을 업로드하지 못했습니다.",
        );
      } finally {
        if (mountedRef.current) setPendingCount((count) => count - 1);
      }
    });
  };

  const removeItem = (id: string) => {
    const target = photosRef.current.find((item) => getId(item) === id);
    if (target) {
      const preview = getPreview(target);
      if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview);
    }
    const next = photosRef.current.filter((item) => getId(item) !== id);
    photosRef.current = next;
    onChange(next);
  };

  return { pendingCount, addFiles, removeItem };
}
