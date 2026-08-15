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

  it('ratio="auto"는 비율 박스 없이 이미지 원본 높이를 따른다', () => {
    render(<ImageFrame ratio="auto" src="/tall.webp" alt="상세" />);

    const img = screen.getByRole("img", { name: "상세" });
    expect(img.className).toContain("w-full");
    expect(img.className).not.toContain("absolute");
  });

  it('fill이면 ratio="auto"여도 부모를 채운다', () => {
    render(<ImageFrame ratio="auto" fill src="/tall.webp" alt="채움" />);

    const img = screen.getByRole("img", { name: "채움" });
    expect(img.className).toContain("absolute");
    expect(img.className).toContain("object-cover");
  });
});
