// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DesignCanvas } from "./design-canvas";

/** 브레이크포인트 스텁 — breakpoint.ts가 mql을 캐시하므로 getter로 바꿔 읽는다. */
let desktop = true;

/** display:none은 접근성 트리에서 빠지므로 실제로 보이는 미리보기 하나만 잡힌다. */
function visiblePreviewWrapper() {
  const imgs = screen.getAllByRole("img", { name: /선택한 디자인 미리보기/ });
  expect(imgs).toHaveLength(1);
  return imgs[0]?.parentElement?.parentElement as HTMLElement;
}

describe("DesignCanvas 타일 모드", () => {
  beforeEach(() => {
    desktop = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return desktop && query.includes("min-width");
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("모바일에서는 여백 없는 풀블리드 레이어가 뜬다", () => {
    desktop = false;
    render(<DesignCanvas imageSrc="data:image/svg+xml,<svg/>" mode="repeat" />);
    expect(visiblePreviewWrapper().style.position).toBe("absolute");
  });

  it("PC에서는 기존 정사각 캔버스를 유지한다", () => {
    render(<DesignCanvas imageSrc="data:image/svg+xml,<svg/>" mode="repeat" />);
    expect(visiblePreviewWrapper().style.aspectRatio).toBe("1");
  });

  it("넥타이 모드는 모바일에서도 풀블리드로 깔리지 않는다", () => {
    desktop = false;
    render(<DesignCanvas imageSrc="data:image/svg+xml,<svg/>" mode="tie" />);
    screen.getByRole("img", { name: /넥타이 적용 모습/ });
    expect(
      screen.queryAllByRole("img", { name: "선택한 디자인 미리보기" }),
    ).toHaveLength(0);
  });
});
