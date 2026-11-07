// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ReformSettingsModal,
  type ReformSettingsValues,
} from "./bulk-apply-modal";

const initialValues: ReformSettingsValues = {
  automaticEnabled: true,
  mechanism: "zipper",
  wearerHeightCm: 175,
  totalLengthCm: null,
  dimple: false,
  turnKnot: false,
  widthEnabled: false,
  targetWidthCm: null,
  restorationEnabled: false,
  restorationMemo: "",
};

function renderModal() {
  render(
    <ReformSettingsModal
      open
      title="수선 옵션"
      initialValues={initialValues}
      onOpenChange={vi.fn()}
      onApply={vi.fn()}
    />,
  );
}

const checkbox = (name: string) =>
  screen.getByRole("checkbox", { name }) as HTMLInputElement;

describe("ReformSettingsModal 추가 옵션", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("딤플을 켜면 돌려묶기가 켜지고 잠긴다", () => {
    renderModal();

    fireEvent.click(checkbox("딤플"));

    expect(checkbox("돌려묶기").checked).toBe(true);
    expect(checkbox("돌려묶기").disabled).toBe(true);
    screen.getByText("딤플을 선택하면 돌려묶기로 고정됩니다.");
  });

  it("끈으로 바꾸면 딤플이 사라지고 돌려묶기는 남는다", () => {
    renderModal();

    fireEvent.click(checkbox("딤플"));
    fireEvent.click(screen.getByRole("radio", { name: "끈" }));

    expect(screen.queryByRole("checkbox", { name: "딤플" })).toBeNull();
    expect(checkbox("돌려묶기").checked).toBe(true);
    expect(checkbox("돌려묶기").disabled).toBe(false);
  });

  it("길이 입력으로 바꾸면 키를 비우고 길이만 저장한다", async () => {
    const onApply = vi.fn();
    render(
      <ReformSettingsModal
        open
        title="수선 옵션"
        initialValues={initialValues}
        onOpenChange={vi.fn()}
        onApply={onApply}
      />,
    );
    screen.getByText("권장 넥타이 길이 51cm (매듭 포함)");

    fireEvent.click(screen.getByRole("radio", { name: "길이" }));
    fireEvent.change(screen.getByLabelText(/넥타이 길이/), {
      target: { value: "48" },
    });
    fireEvent.click(screen.getByRole("button", { name: "변경" }));

    await vi.waitFor(() =>
      expect(onApply).toHaveBeenCalledWith(
        expect.objectContaining({ wearerHeightCm: null, totalLengthCm: 48 }),
      ),
    );
  });
});
