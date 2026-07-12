import { describe, expect, it } from "vitest";

import { parseAdminListQuery, serializeAdminListQuery } from "./url-query";

describe("admin list URL query", () => {
  it("허용된 비민감 필드만 파싱한다", () => {
    const params = new URLSearchParams(
      "page=3&limit=50&sort=created_at&direction=desc&status=paid&q=secret&email=user%40example.com",
    );

    expect(
      parseAdminListQuery(params, {
        allowedSorts: ["created_at"],
        allowedStatuses: ["paid"],
      }),
    ).toEqual({
      page: 3,
      limit: 50,
      sort: "created_at",
      direction: "desc",
      status: "paid",
      type: undefined,
      from: undefined,
      to: undefined,
      tab: undefined,
    });
  });

  it("잘못된 page·sort를 안전한 기본값으로 되돌린다", () => {
    const parsed = parseAdminListQuery(
      new URLSearchParams(
        "page=-1&limit=999&sort=private_field&status=unknown&from=not-a-date",
      ),
      { allowedSorts: ["created_at"], defaultSort: "created_at" },
    );

    expect(parsed.page).toBe(1);
    expect(parsed.limit).toBe(20);
    expect(parsed.sort).toBe("created_at");
    expect(parsed.status).toBeUndefined();
    expect(parsed.from).toBeUndefined();
  });

  it("화면이 지정한 기본 정렬 방향을 사용하되 URL 값을 우선한다", () => {
    expect(
      parseAdminListQuery(new URLSearchParams(), {
        defaultDirection: "desc",
      }).direction,
    ).toBe("desc");
    expect(
      parseAdminListQuery(new URLSearchParams("direction=asc"), {
        defaultDirection: "desc",
      }).direction,
    ).toBe("asc");
  });

  it("직렬화할 때 PII나 알 수 없는 query를 보존하지 않는다", () => {
    const parsed = parseAdminListQuery(
      new URLSearchParams("page=2&q=01012345678&name=홍길동"),
    );
    const result = serializeAdminListQuery(parsed).toString();

    expect(result).toBe("page=2");
    expect(result).not.toContain("01012345678");
    expect(result).not.toContain("홍길동");
  });
});
