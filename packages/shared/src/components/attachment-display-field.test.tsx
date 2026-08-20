// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttachmentDisplayField } from "./attachment-display-field";

const item = { id: "a", src: "https://example.com/a.png", alt: "참고 1" };

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

describe("AttachmentDisplayField 확대", () => {
  it("previewable이면 썸네일 클릭으로 확대 Modal을 연다", () => {
    render(<AttachmentDisplayField previewable items={[item]} />);

    fireEvent.click(screen.getByRole("button", { name: "참고 1 확대" }));

    const dialog = screen.getByRole("dialog", { name: "참고 1 확대" });
    expect(
      within(dialog).getByRole<HTMLImageElement>("img", { name: "참고 1" }).src,
    ).toBe(item.src);
  });

  it("previewable이 아니면 썸네일에 확대 버튼이 없다", () => {
    render(<AttachmentDisplayField items={[item]} />);

    expect(screen.queryByRole("button", { name: "참고 1 확대" })).toBeNull();
  });
});
