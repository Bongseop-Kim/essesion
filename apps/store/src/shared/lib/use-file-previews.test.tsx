// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useFilePreviews } from "./use-file-previews";

describe("useFilePreviews", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates URLs only when files are added and revokes removed or remaining URLs", () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const first = new File(["first"], "first.png", { type: "image/png" });
    const second = new File(["second"], "second.png", {
      type: "image/png",
    });
    const { result, unmount } = renderHook(() => useFilePreviews(2));

    expect(createObjectURL).not.toHaveBeenCalled();

    act(() => result.current.addFiles([first, second]));

    expect(result.current.previews.map(({ id }) => id)).toEqual([
      "blob:first",
      "blob:second",
    ]);
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    act(() => result.current.removeFile("blob:second"));

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:second");
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    unmount();

    expect(revokeObjectURL).toHaveBeenCalledWith("blob:first");
  });
});
