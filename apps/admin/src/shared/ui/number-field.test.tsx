import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { NumberField } from "./number-field";

function Harness({ allowNegative = false }: { allowNegative?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <>
      <NumberField
        label="금액"
        value={value}
        onValueChange={setValue}
        allowNegative={allowNegative}
      />
      <output>{value}</output>
    </>
  );
}

function renderField(allowNegative = false) {
  render(<Harness allowNegative={allowNegative} />);
  return screen.getByLabelText("금액") as HTMLInputElement;
}

describe("NumberField", () => {
  it("천 단위 콤마를 붙여 보여주고 원본은 숫자만 넘긴다", async () => {
    const user = userEvent.setup();
    const input = renderField();

    // 기본값은 양수만 — 부호·문자는 걸러진다.
    await user.type(input, "-1a2b3456");

    expect(input.value).toBe("123,456");
    expect(screen.getByRole("status").textContent).toBe("123456");
  });

  it("가운데를 수정해도 캐럿이 끝으로 튀지 않는다", async () => {
    const user = userEvent.setup();
    const input = renderField();

    await user.type(input, "1234");
    expect(input.value).toBe("1,234");
    // "1|,234" 위치에서 5를 입력 → "15,234"의 두 번째 숫자 뒤에 캐럿이 남는다.
    await user.type(input, "5", {
      initialSelectionStart: 1,
      initialSelectionEnd: 1,
    });

    expect(input.value).toBe("15,234");
    expect(input.selectionStart).toBe(2);
  });

  it("allowNegative면 선행 부호를 유지한다", async () => {
    const user = userEvent.setup();
    const input = renderField(true);

    await user.type(input, "-1200");

    expect(input.value).toBe("-1,200");
    expect(screen.getByRole("status").textContent).toBe("-1200");
  });
});
