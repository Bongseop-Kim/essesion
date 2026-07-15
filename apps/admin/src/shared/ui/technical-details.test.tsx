import { SnackbarHost } from "@essesion/shared";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TechnicalDetails } from "./technical-details";

const originalClipboard = Object.getOwnPropertyDescriptor(
  navigator,
  "clipboard",
);

afterEach(() => {
  if (originalClipboard === undefined) {
    Reflect.deleteProperty(navigator, "clipboard");
    return;
  }
  Object.defineProperty(navigator, "clipboard", originalClipboard);
});

describe("TechnicalDetails", () => {
  it("JSON을 기본으로 접고 펼친 뒤 복사한다", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const json = { request_id: "request-1", attempts: 2 };

    render(
      <>
        <TechnicalDetails json={json} />
        <SnackbarHost />
      </>,
    );

    const trigger = screen.getByRole("button", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "기술 정보" })).toBeNull();
    expect(screen.queryByRole("button", { name: "기술 정보 복사" })).toBeNull();

    await user.click(trigger);

    const region = screen.getByRole("region", { name: "기술 정보" });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(within(region).getByText(/"request_id": "request-1"/)).toBeTruthy();

    await user.click(
      within(region).getByRole("button", { name: "기술 정보 복사" }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(json, null, 2)),
    );
    expect(await screen.findByText("기술 정보를 복사했습니다.")).toBeTruthy();
  });

  it("JSON 대신 원문을 표시할 수 있다", async () => {
    const user = userEvent.setup();
    render(<TechnicalDetails title="원문 정보" rawText="raw payload" />);

    await user.click(screen.getByRole("button", { name: "원문 정보" }));

    expect(
      within(screen.getByRole("region", { name: "원문 정보" })).getByText(
        "raw payload",
      ),
    ).toBeTruthy();
  });
});
