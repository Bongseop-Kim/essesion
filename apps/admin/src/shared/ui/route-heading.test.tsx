import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, Route, Routes, useParams } from "react-router";
import { describe, expect, it } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";
import { RouteHeading } from "./route-heading";

function DetailPage() {
  const { itemId } = useParams();
  return (
    <>
      <RouteHeading title="항목 상세" description={`항목 ${itemId}`} />
      <Link to={itemId === "one" ? "/items/two" : "/items/one"}>다음 항목</Link>
    </>
  );
}

describe("RouteHeading", () => {
  it("제목이 같은 param route 전환에도 heading으로 focus를 이동한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(
      <Routes>
        <Route path="/items/:itemId" element={<DetailPage />} />
      </Routes>,
      { entry: "/items/one" },
    );

    const link = await screen.findByRole("link", { name: "다음 항목" });
    await user.click(link);

    await screen.findByText("항목 two");
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "항목 상세", level: 1 }),
      ),
    );
  });
});
