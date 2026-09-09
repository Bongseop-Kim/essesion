import { fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const create = vi.hoisted(() => vi.fn());
vi.mock("@essesion/api-client/query", () => ({
  createAdminPopupMutation: () => ({ mutationFn: create }),
  listAdminPopupsQueryKey: () => ["popups"],
}));

import { PopupNewPage } from "./form";

it("제출 오류를 요약하고 폼 순서의 첫 오류 필드에 매번 초점을 맞춘다", () => {
  renderAdminPage(<PopupNewPage />);
  const submit = screen.getByRole("button", { name: "비활성으로 등록" });
  fireEvent.click(submit);
  const title = screen.getByLabelText(/^제목/);
  expect(document.activeElement).toBe(title);
  expect(
    within(screen.getByRole("alert")).getByText("제목을 입력해 주세요."),
  ).toBeTruthy();
  expect(
    document.getElementById(title.getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe("제목을 입력해 주세요.");

  fireEvent.change(title, { target: { value: "운영 안내" } });
  fireEvent.click(screen.getByRole("radio", { name: /배송·운영 안내/ }));
  fireEvent.click(submit);
  const label = screen.getByLabelText("1행 라벨");
  expect(document.activeElement).toBe(label);
  fireEvent.change(label, { target: { value: "요금" } });
  fireEvent.click(submit);
  const value = screen.getByLabelText("1행 값");
  expect(document.activeElement).toBe(value);
  expect(
    document.getElementById(value.getAttribute("aria-describedby") ?? "")
      ?.textContent,
  ).toBe("1행 값을 입력해 주세요.");
  expect(create).not.toHaveBeenCalled();
});
