import { describe, expect, it } from "vitest";

import { queryClient } from "./query-client";

describe("store query defaults", () => {
  it("탭으로 돌아오면 fresh 여부와 관계없이 서버 상태를 다시 읽는다", () => {
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(
      "always",
    );
  });
});
