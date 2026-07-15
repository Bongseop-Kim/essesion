import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SafeSvgPreview } from "./safe-svg-preview";

const createObjectURL = vi.fn(() => "blob:safe-svg");
const revokeObjectURL = vi.fn();

describe("SafeSvgPreview", () => {
  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectURL },
      revokeObjectURL: { configurable: true, value: revokeObjectURL },
    });
  });

  it("safe 문자열을 DOM에 주입하지 않고 Blob 이미지로만 렌더한다", async () => {
    const payload =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="1" height="1"/></svg>';
    const { container } = render(
      <SafeSvgPreview svg={payload} status="safe" alt="안전 SVG" />,
    );

    const image = await screen.findByRole("img", { name: "안전 SVG" });
    expect(image.getAttribute("src")).toBe("blob:safe-svg");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector("[srcdoc]")).toBeNull();
  });

  it("상태 변경과 unmount에서 Blob URL을 폐기하고 unsafe는 차단한다", async () => {
    const { rerender, unmount } = render(
      <SafeSvgPreview
        svg={'<svg xmlns="http://www.w3.org/2000/svg" />'}
        status="safe"
        alt="첫 미리보기"
      />,
    );
    await screen.findByRole("img", { name: "첫 미리보기" });

    rerender(
      <SafeSvgPreview
        svg={'<svg xmlns="http://www.w3.org/2000/svg"><rect /></svg>'}
        status="safe"
        alt="두 번째 미리보기"
      />,
    );
    await screen.findByRole("img", { name: "두 번째 미리보기" });
    await waitFor(() =>
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:safe-svg"),
    );

    rerender(
      <SafeSvgPreview
        svg={'<svg xmlns="http://www.w3.org/2000/svg" />'}
        status="unsafe"
        alt="차단 미리보기"
      />,
    );
    expect(await screen.findByText("안전하지 않은 SVG")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "차단 미리보기" })).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(2);

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});
