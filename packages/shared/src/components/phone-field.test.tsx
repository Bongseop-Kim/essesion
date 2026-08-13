// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalizePhoneNumber,
  formatPhoneInput,
  formatPhoneNumber,
  PhoneField,
} from "./phone-field";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PhoneField", () => {
  it("하이픈 유무가 섞인 기존 번호를 같은 형식으로 표시한다", () => {
    const { rerender } = render(
      <PhoneField
        label="휴대폰"
        value="01012345678"
        onValueChange={() => undefined}
      />,
    );

    expect((screen.getByLabelText("휴대폰") as HTMLInputElement).value).toBe(
      "010-1234-5678",
    );

    rerender(
      <PhoneField
        label="휴대폰"
        value="010-1234-5678"
        onValueChange={() => undefined}
      />,
    );
    expect((screen.getByLabelText("휴대폰") as HTMLInputElement).value).toBe(
      "010-1234-5678",
    );
  });

  it("숫자만 입력값으로 전달하고 화면에는 하이픈을 표시한다", () => {
    const onValueChange = vi.fn();
    function PhoneFieldHarness() {
      const [value, setValue] = useState("");
      return (
        <PhoneField
          label="휴대폰"
          value={value}
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    }
    render(<PhoneFieldHarness />);
    const input = screen.getByLabelText("휴대폰") as HTMLInputElement;

    fireEvent.change(input, { target: { value: "01012345678" } });

    expect(onValueChange).toHaveBeenCalledWith("01012345678");
    expect(input.value).toBe("010-1234-5678");
  });
});

describe("phone format helpers", () => {
  it("유효한 번호만 정규화하고 알 수 없는 기존 값은 보존한다", () => {
    expect(canonicalizePhoneNumber(" 010-1234-5678 ")).toBe("01012345678");
    expect(canonicalizePhoneNumber("대표번호 확인 필요")).toBe(
      "대표번호 확인 필요",
    );
    expect(formatPhoneInput("대표번호 확인 필요")).toBe("대표번호 확인 필요");
    expect(formatPhoneNumber("01012345678")).toBe("010-1234-5678");
    expect(formatPhoneNumber("0111234567")).toBe("011-123-4567");
    expect(formatPhoneNumber("대표번호 확인 필요")).toBe("대표번호 확인 필요");
  });
});
