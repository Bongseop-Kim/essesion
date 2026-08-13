import { screen, within } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";

type User = ReturnType<typeof userEvent.setup>;

/** ListPicker(FilterSelect): 트리거 클릭 → 열린 피커에서 옵션 클릭 */
export async function pickOption(
  user: User,
  label: string | RegExp,
  option: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: label });
  await user.click(within(dialog).getByRole("button", { name: option }));
}

/** 네이티브 날짜 입력에 YYYY-MM-DD 값을 넣는다. */
export async function pickDate(
  user: User,
  label: string | RegExp,
  iso: string,
) {
  const input = screen.getByLabelText(label);
  await user.clear(input);
  await user.type(input, iso);
}
