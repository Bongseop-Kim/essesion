// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageFrame } from "./image-frame";

describe("ImageFrame", () => {
  it("src가 바뀌면 첫 render부터 새 이미지를 시도한다", () => {
    const onError = vi.fn();
    const { rerender } = render(
      <ImageFrame
        src="/broken.webp"
        alt="상품"
        onError={onError}
        fallback={<span>이미지 없음</span>}
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "상품" }));
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByText("이미지 없음")).toBeTruthy();

    rerender(
      <ImageFrame
        src="/renewed.webp"
        alt="상품"
        fallback={<span>이미지 없음</span>}
      />,
    );

    expect(screen.getByRole("img", { name: "상품" }).getAttribute("src")).toBe(
      "/renewed.webp",
    );
  });
});
