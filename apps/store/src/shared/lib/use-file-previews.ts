import { useEffect, useRef, useState } from "react";

export type FilePreview = {
  id: string;
  file: File;
  url: string;
  revoke: () => void;
};

function createFilePreview(file: File): FilePreview {
  // oxlint-disable-next-line react-doctor/no-create-object-url-without-revoke -- removeFile and the unmount cleanup call this resource's revoke callback.
  const url = URL.createObjectURL(file);
  return {
    id: url,
    file,
    url,
    revoke: () => URL.revokeObjectURL(url),
  };
}

export function useFilePreviews(maxFiles: number) {
  const [previews, setPreviews] = useState<FilePreview[]>([]);
  const previewsRef = useRef(previews);

  useEffect(
    () => () => {
      for (const preview of previewsRef.current) preview.revoke();
    },
    [],
  );

  const addFiles = (files: File[], reservedSlots = 0) => {
    const remaining = Math.max(
      0,
      maxFiles - reservedSlots - previewsRef.current.length,
    );
    const additions = files.slice(0, remaining).map(createFilePreview);
    const next = [...previewsRef.current, ...additions];
    previewsRef.current = next;
    setPreviews(next);
  };

  const removeFile = (id: string) => {
    const preview = previewsRef.current.find((item) => item.id === id);
    if (!preview) return;
    preview.revoke();
    const next = previewsRef.current.filter((item) => item.id !== id);
    previewsRef.current = next;
    setPreviews(next);
  };

  return { previews, addFiles, removeFile };
}
