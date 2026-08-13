// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NumberField } from "./number-field";

afterEach(cleanup);

describe("NumberField", () => {
  it("원화 입력은 천 단위로 표시하고 숫자 원문을 전달한다", () => {
    const onValueChange = vi.fn();
    function NumberFieldHarness() {
      const [value, setValue] = useState("1000");
      return (
        <NumberField
          groupThousands
          label="금액"
          value={value}
          onValueChange={(nextValue) => {
            onValueChange(nextValue);
            setValue(nextValue);
          }}
        />
      );
    }
    render(<NumberFieldHarness />);
    const input = screen.getByLabelText("금액") as HTMLInputElement;

    expect(input.value).toBe("1,000");
    fireEvent.change(input, { target: { value: "12,345,678원" } });

    expect(onValueChange).toHaveBeenCalledWith("12345678");
    expect(input.value).toBe("12,345,678");
  });

  it("일반 숫자 입력에는 그룹 구분을 적용하지 않는다", () => {
    render(
      <NumberField label="수량" value="1000" onValueChange={() => undefined} />,
    );

    const input = screen.getByLabelText("수량") as HTMLInputElement;
    expect(input.type).toBe("number");
    expect(input.value).toBe("1000");
  });
});
