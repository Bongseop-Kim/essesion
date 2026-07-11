import { describe, expect, it } from "vitest";

import { getVisibleNotices, type NoticeItem } from "./notice-data";

function notice(
  id: string,
  published_at: string,
  pinned = false,
  is_visible = true,
): NoticeItem {
  return {
    id,
    category: "공지",
    title: id,
    content: id,
    pinned,
    is_visible,
    published_at,
  };
}

describe("getVisibleNotices", () => {
  it("keeps pinned notices first and sorts each group newest first", () => {
    const result = getVisibleNotices([
      notice("normal-new", "2026-07-11"),
      notice("pinned-old", "2026-07-01", true),
      notice("pinned-new", "2026-07-10", true),
      notice("normal-old", "2026-06-01"),
    ]);

    expect(result.map((item) => item.id)).toEqual([
      "pinned-new",
      "pinned-old",
      "normal-new",
      "normal-old",
    ]);
  });

  it("omits notices that are not visible", () => {
    expect(
      getVisibleNotices([
        notice("visible", "2026-07-11"),
        notice("hidden", "2026-07-12", true, false),
      ]).map((item) => item.id),
    ).toEqual(["visible"]);
  });
});
