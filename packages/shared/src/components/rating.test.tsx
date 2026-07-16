// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Rating } from "./rating";

afterEach(cleanup);

describe("Rating", () => {
  it("표시 별점을 0.5점 단위로 반올림한다", () => {
    const { container } = render(<Rating value={4.26} />);

    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "5점 만점에 4.5점",
    );
    expect(
      [...container.querySelectorAll("[data-fill]")].map((star) =>
        star.getAttribute("data-fill"),
      ),
    ).toEqual(["1", "1", "1", "1", "0.5"]);
  });

  it("네이티브 라디오 입력으로 별점을 변경한다", () => {
    const onChange = vi.fn();
    render(<Rating value={2} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: "4점" }));
    expect(onChange).toHaveBeenCalledWith(4);
  });
});
