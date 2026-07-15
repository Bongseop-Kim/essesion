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

/** DatePicker: 트리거 클릭 → 해·달 이동 → 날짜 클릭. iso = "YYYY-MM-DD" */
export async function pickDate(
  user: User,
  label: string | RegExp,
  iso: string,
) {
  await user.click(screen.getByRole("button", { name: label }));
  const dialog = await screen.findByRole("dialog", { name: label });
  const shown = within(dialog).getByText(/^\d+년 \d+월$/).textContent ?? "";
  const [year = 0, month = 0] = shown.match(/\d+/g)?.map(Number) ?? [];
  let delta =
    (Number(iso.slice(0, 4)) - year) * 12 + (Number(iso.slice(5, 7)) - month);
  const step = (name: string) =>
    user.click(within(dialog).getByRole("button", { name }));
  for (; Math.abs(delta) >= 12; delta -= Math.sign(delta) * 12)
    await step(delta > 0 ? "다음 해" : "이전 해");
  for (; delta !== 0; delta -= Math.sign(delta))
    await step(delta > 0 ? "다음 달" : "이전 달");
  const dayName = new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
  }).format(new Date(`${iso}T00:00`));
  await user.click(within(dialog).getByRole("button", { name: dayName }));
}
