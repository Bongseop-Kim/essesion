import { Box, cn, VStack } from "@essesion/shared";
import type { ReactNode } from "react";
import { useState } from "react";

type StickySection = {
  id: string;
  label: string;
  content: ReactNode;
};

type StickySectionNavProps = {
  "aria-label": string;
  sections: readonly StickySection[];
};

export function StickySectionNav({
  sections,
  "aria-label": ariaLabel,
}: StickySectionNavProps) {
  const [activeId, setActiveId] = useState(sections[0]?.id);

  return (
    <>
      <Box
        as="nav"
        aria-label={ariaLabel}
        position="sticky"
        top={{ base: "x14", md: "x16" }}
        zIndex="z.sticky"
        bg="bg.layer-default"
        className="flex border-b border-stroke-neutral-weak"
      >
        {sections.map((section) => {
          const active = activeId === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active ? "location" : undefined}
              onClick={() => setActiveId(section.id)}
              className={cn(
                "-mb-px flex h-11 flex-1 items-center justify-center border-b-2 px-x4 text-t5 font-bold transition-colors duration-100 ease-standard",
                "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-stroke-focus-ring",
                active
                  ? "border-stroke-brand text-fg-neutral"
                  : "border-transparent text-fg-neutral-subtle hover:text-fg-neutral",
              )}
            >
              {section.label}
            </a>
          );
        })}
      </Box>

      <VStack gap={0} alignItems="stretch">
        {sections.map((section, index) => (
          <Box
            as="section"
            key={section.id}
            id={section.id}
            aria-label={section.label}
            pt={index === 0 ? "x6" : "x12"}
            pb="x12"
            style={{
              scrollMarginTop: "calc(var(--spacing-x16) + var(--spacing-x14))",
            }}
            className={cn(index > 0 && "border-t border-stroke-neutral-weak")}
          >
            {section.content}
          </Box>
        ))}
      </VStack>
    </>
  );
}

export type { StickySection, StickySectionNavProps };
