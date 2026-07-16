// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  it("공유 프리셋을 시맨틱 크기로 해석한다", () => {
    render(<Skeleton preset="media" data-testid="skeleton" />);

    const skeleton = screen.getByTestId("skeleton");
    expect(skeleton.style.width).toBe("100%");
    expect(skeleton.style.height).toBe("var(--size-loading-media)");
  });
});
