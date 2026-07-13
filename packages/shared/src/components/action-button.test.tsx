// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ActionButton } from "./action-button";

afterEach(cleanup);

describe("ActionButton", () => {
  it("로딩 중에도 원래 버튼 이름을 유지하고 스피너는 숨긴다", () => {
    render(<ActionButton loading>저장</ActionButton>);

    const button = screen.getByRole("button", { name: "저장" });
    const spinner = button.querySelector('[role="progressbar"]');

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
