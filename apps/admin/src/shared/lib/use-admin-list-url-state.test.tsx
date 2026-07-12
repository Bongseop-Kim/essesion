import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { useAdminListUrlState } from "./use-admin-list-url-state";

function Harness() {
  const location = useLocation();
  const { replaceQuery } = useAdminListUrlState({
    allowedStatuses: ["paid"],
  });

  return (
    <>
      <button
        type="button"
        onClick={() => {
          replaceQuery({ status: "paid" });
          replaceQuery({ page: 3 });
        }}
      >
        연속 변경
      </button>
      <output aria-label="현재 query">{location.search}</output>
    </>
  );
}

describe("useAdminListUrlState", () => {
  it("같은 렌더의 연속 patch를 모두 보존한다", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: "연속 변경" }));

    expect(screen.getByLabelText("현재 query").textContent).toBe(
      "?page=3&status=paid",
    );
  });
});
