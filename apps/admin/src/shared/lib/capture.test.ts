import { beforeEach, describe, expect, it, vi } from "vitest";

const domToPng = vi.fn();
vi.mock("modern-screenshot", () => ({
  domToPng: (...args: unknown[]) => domToPng(...args),
}));

const { downloadWorksheetPng } = await import("./capture");

describe("downloadWorksheetPng", () => {
  beforeEach(() => {
    domToPng.mockReset();
    // jsdom은 a[download] 클릭을 네비게이션으로 보고 경고를 뱉는다.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  function capturedWidthOf(node: HTMLElement) {
    let width = "";
    domToPng.mockImplementation(() => {
      width = node.style.width;
      return Promise.resolve("data:image/png;base64,AA");
    });
    return () => width;
  }

  it("캡처 동안만 모바일 폭으로 좁히고 원래 폭을 되돌린다", async () => {
    const node = document.createElement("div");
    node.style.width = "100%";
    vi.spyOn(node, "offsetWidth", "get").mockReturnValue(1280);
    const capturedWidth = capturedWidthOf(node);

    await downloadWorksheetPng(node, "worksheet.png");

    expect(capturedWidth()).toBe("390px");
    expect(node.style.width).toBe("100%");
  });

  it("이미 좁은 화면에서는 폭을 건드리지 않는다", async () => {
    const node = document.createElement("div");
    vi.spyOn(node, "offsetWidth", "get").mockReturnValue(343);
    const capturedWidth = capturedWidthOf(node);

    await downloadWorksheetPng(node, "worksheet.png");

    expect(capturedWidth()).toBe("");
  });

  it("캡처가 실패해도 폭을 되돌린다", async () => {
    const node = document.createElement("div");
    domToPng.mockRejectedValue(new Error("capture failed"));

    await expect(downloadWorksheetPng(node, "worksheet.png")).rejects.toThrow();
    expect(node.style.width).toBe("");
  });
});
