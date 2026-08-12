// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@essesion/shared", () => ({ snackbar: vi.fn() }));

import { usePhotoUploadQueue } from "./use-photo-upload-queue";

type Photo = { id: string; preview: string };

describe("usePhotoUploadQueue", () => {
  afterEach(() => vi.restoreAllMocks());

  it("언마운트 뒤 완료된 업로드의 blob URL을 해제한다", async () => {
    let completeUpload: (photo: Photo) => void = () => undefined;
    const upload = vi.fn(
      () =>
        new Promise<Photo>((resolve) => {
          completeUpload = resolve;
        }),
    );
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
    const { result, unmount } = renderHook(() =>
      usePhotoUploadQueue<Photo>({
        photos: [],
        max: 1,
        upload,
        getId: (photo) => photo.id,
        getPreview: (photo) => photo.preview,
        onChange: vi.fn(),
      }),
    );

    let pending: Promise<void> = Promise.resolve();
    await act(async () => {
      pending = result.current.addFiles([
        new File(["photo"], "photo.jpg", { type: "image/jpeg" }),
      ]);
    });
    unmount();

    completeUpload({ id: "photo-1", preview: "blob:photo-1" });
    await pending;

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:photo-1");
  });
});
