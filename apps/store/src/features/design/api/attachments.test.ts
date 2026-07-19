import { describe, expect, it } from "vitest";

import { MAX_DESIGN_SVG_BYTES, readDesignMotifSvg } from "./attachments";

function svgFile(bytes: number[]) {
  return {
    name: "motif.svg",
    type: "image/svg+xml",
    size: bytes.length,
    arrayBuffer: async () => Uint8Array.from(bytes).buffer,
  } as File;
}

describe("readDesignMotifSvg", () => {
  it("올바른 UTF-8 SVG를 읽는다", async () => {
    const bytes = Array.from(
      new TextEncoder().encode('<svg viewBox="0 0 1 1"></svg>'),
    );
    await expect(readDesignMotifSvg(svgFile(bytes))).resolves.toContain("<svg");
  });

  it("잘못된 UTF-8 바이트를 거부한다", async () => {
    await expect(readDesignMotifSvg(svgFile([0xc3, 0x28]))).rejects.toThrow(
      "UTF-8",
    );
  });

  it("API·worker와 같은 2,000,000 byte 상한을 적용한다", async () => {
    const file = {
      name: "motif.svg",
      type: "image/svg+xml",
      size: MAX_DESIGN_SVG_BYTES + 1,
      arrayBuffer: async () => new ArrayBuffer(0),
    } as File;

    await expect(readDesignMotifSvg(file)).rejects.toThrow("2MB");
  });
});
