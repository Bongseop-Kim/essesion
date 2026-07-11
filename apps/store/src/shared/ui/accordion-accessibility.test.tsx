import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@essesion/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("Accordion accessibility", () => {
  function render(defaultValue?: string) {
    return renderToStaticMarkup(
      <Accordion defaultValue={defaultValue}>
        <AccordionItem value="details">
          <AccordionTrigger>상세</AccordionTrigger>
          <AccordionContent>
            <button type="button">수정</button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>,
    );
  }

  it("removes collapsed interactive content from focus and the accessibility tree", () => {
    const html = render();

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('inert=""');
  });

  it("keeps expanded content interactive", () => {
    const html = render("details");
    const section = html.match(/<section[^>]*>/)?.[0];

    expect(section).toBeDefined();
    expect(section).not.toContain("aria-hidden");
    expect(section).not.toContain("inert");
  });
});
