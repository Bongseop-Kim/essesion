import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { Hero } from "./hero";

describe("home hero accessibility", () => {
  it("캐러셀 이름·슬라이드 상태·자동 넘김 제어를 제공한다", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <Hero />
      </MemoryRouter>,
    );

    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('aria-label="주요 서비스"');
    expect(html).toContain("자동 넘김 일시정지");
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
  });
});
