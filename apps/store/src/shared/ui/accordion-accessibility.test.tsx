// @vitest-environment jsdom

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@essesion/shared";
import { render as renderDom, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

  it("uses native details/summary disclosure semantics", () => {
    const html = render();

    expect(html).toContain("<details");
    expect(html).toContain("<summary");
    expect(html).not.toContain(" open");
  });

  it("marks the default item open", () => {
    const html = render("details");
    const details = html.match(/<details[^>]*>/)?.[0];

    expect(details).toContain("open");
  });

  it("keeps a controlled multiple accordion in sync with native toggles", async () => {
    const user = userEvent.setup();
    function ControlledAccordion() {
      const [value, setValue] = useState<string[]>([]);
      return (
        <Accordion type="multiple" value={value} onValueChange={setValue}>
          <AccordionItem value="first">
            <AccordionTrigger>첫째</AccordionTrigger>
            <AccordionContent>첫째 내용</AccordionContent>
          </AccordionItem>
          <AccordionItem value="second">
            <AccordionTrigger>둘째</AccordionTrigger>
            <AccordionContent>둘째 내용</AccordionContent>
          </AccordionItem>
        </Accordion>
      );
    }

    renderDom(<ControlledAccordion />);
    await user.click(screen.getByText("첫째"));
    await user.click(screen.getByText("둘째"));

    await waitFor(() => {
      expect(screen.getByText("첫째").closest("details")?.open).toBe(true);
      expect(screen.getByText("둘째").closest("details")?.open).toBe(true);
    });
  });
});
