// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => ({ photo: vi.fn() }));

vi.mock("../api/upload", () => ({
  REPAIR_PHOTO_ACCEPT: "image/jpeg,image/png,image/webp",
  uploadRepairShippingPhoto: upload.photo,
}));

import { emptyShipmentForm } from "../model/shipment";
import { RepairShipmentFields } from "./repair-shipment-fields";

/** 소비처(주문서·발송 확인 페이지)와 같은 계약 — patch를 최신 폼에 병합한다. */
function ShipmentFieldsHost() {
  const [form, setForm] = useState(emptyShipmentForm);
  return (
    <RepairShipmentFields
      state={form}
      onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
    />
  );
}

function fileInput() {
  return screen
    .getAllByLabelText("사진 추가")
    .find((element) => element instanceof HTMLInputElement) as HTMLInputElement;
}

function memoField() {
  return screen.getByLabelText("메모") as HTMLTextAreaElement;
}

describe("RepairShipmentFields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: () => "blob:repair-photo" },
      revokeObjectURL: { configurable: true, value: () => undefined },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("업로드가 끝나도 그 사이 입력한 메모를 덮어쓰지 않는다", async () => {
    const user = userEvent.setup();
    let completeUpload: (objectKey: string) => void = () => undefined;
    upload.photo.mockReturnValueOnce(
      new Promise<string>((resolve) => {
        completeUpload = resolve;
      }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShipmentFieldsHost />
      </QueryClientProvider>,
    );

    await user.upload(
      fileInput(),
      new File(["photo"], "shipment.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(upload.photo).toHaveBeenCalledTimes(1));

    // 업로드가 진행 중인 동안 메모를 입력한다 — 완료 콜백이 들고 있던 폼은 메모 이전 값이다.
    await user.click(memoField());
    await user.paste("지퍼 손잡이가 빠졌어요");
    expect(memoField().value).toBe("지퍼 손잡이가 빠졌어요");

    completeUpload("repair/shipment.jpg");

    await waitFor(() => expect(screen.getByText("1/3")).toBeTruthy());
    expect(memoField().value).toBe("지퍼 손잡이가 빠졌어요");
  });
});
