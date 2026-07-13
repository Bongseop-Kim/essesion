// @vitest-environment jsdom

import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScrollFog } from "./scroll-fog";

describe("ScrollFog", () => {
  let resize: ResizeObserverCallback;
  const observe = vi.fn();

  beforeEach(() => {
    observe.mockClear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          resize = callback;
        }
        observe = observe;
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("direct child resize를 관찰해 스크롤 끝 fog를 다시 계산한다", () => {
    let scrollWidth = 100;
    const { getByTestId } = render(
      <ScrollFog direction="horizontal" data-testid="fog">
        <span data-testid="content">내용</span>
      </ScrollFog>,
    );
    const fog = getByTestId("fog");
    const content = getByTestId("content");
    Object.defineProperties(fog, {
      clientWidth: { configurable: true, get: () => 100 },
      scrollLeft: { configurable: true, get: () => 0 },
      scrollWidth: { configurable: true, get: () => scrollWidth },
    });

    expect(observe).toHaveBeenCalledWith(fog);
    expect(observe).toHaveBeenCalledWith(content);
    const contentResize: ResizeObserverEntry = {
      target: content,
      contentRect: content.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    act(() => resize([contentResize], {} as ResizeObserver));
    expect(fog.style.maskImage).not.toContain("transparent");

    scrollWidth = 200;
    act(() => resize([contentResize], {} as ResizeObserver));
    expect(fog.style.maskImage).toContain("transparent");
  });
});
