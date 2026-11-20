// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ZoomableImage } from "./zoomable-image";

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute("open");
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ZoomableImage", () => {
  it("누르면 Modal에 zoom 소스를 띄운다", () => {
    render(
      <ZoomableImage
        src="https://example.com/s.png"
        alt="수선 사진 1"
        zoom={{ src: "https://example.com/l.png" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "수선 사진 1 확대" }));

    const dialog = screen.getByRole("dialog", { name: "수선 사진 1 확대" });
    expect(
      within(dialog).getByRole<HTMLImageElement>("img", { name: "수선 사진 1" })
        .src,
    ).toBe("https://example.com/l.png");
  });

  it("zoom이 없으면 같은 src를 띄운다", () => {
    render(<ZoomableImage src="https://example.com/s.png" alt="참고 1" />);

    fireEvent.click(screen.getByRole("button", { name: "참고 1 확대" }));

    expect(
      within(screen.getByRole("dialog")).getByRole<HTMLImageElement>("img").src,
    ).toBe("https://example.com/s.png");
  });

  it("src가 없으면 버튼이 비활성이다", () => {
    render(<ZoomableImage alt="참고 1" />);

    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "참고 1 확대" })
        .disabled,
    ).toBe(true);
  });
});
