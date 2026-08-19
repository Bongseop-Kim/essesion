import { Box, cn, Flex, VStack } from "@essesion/shared";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

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
  const initialHash = window.location.hash.slice(1);
  const hashIsSection = sections.some((section) => section.id === initialHash);
  const [activeId, setActiveId] = useState(() =>
    hashIsSection ? initialHash : sections[0]?.id,
  );
  // 아래쪽 섹션의 content(무한쿼리 포함)를 진입 즉시 마운트하지 않는다 — 근접 시 공개,
  // 한 번 공개되면 유지. 해시 딥링크는 앵커 위치가 어긋나지 않게 전부 공개로 시작한다.
  const [revealedIds, setRevealedIds] = useState<ReadonlySet<string>>(() =>
    hashIsSection
      ? new Set(sections.map((section) => section.id))
      : new Set(sections[0] ? [sections[0].id] : []),
  );
  // 소비자가 sections를 인라인 배열로 넘겨 identity가 렌더마다 바뀐다 — id 목록으로 안정화.
  const idsKey = sections.map((section) => section.id).join(",");

  useEffect(() => {
    const ids = idsKey.split(",");
    if (typeof IntersectionObserver === "undefined") {
      setRevealedIds(new Set(ids));
      return;
    }
    // 스크롤 스파이 — sticky 헤더+탭 아래 상단 밴드에 걸린 섹션을 활성으로 표시.
    const spy = new IntersectionObserver(
      (entries) => {
        const topmost = entries
          .filter((entry) => entry.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (topmost) setActiveId(topmost.target.id);
      },
      { rootMargin: "-120px 0px -60% 0px" },
    );
    // 지연 마운트 — 뷰포트 하단에 근접한 섹션부터 공개한다. 공개는 항상 뷰포트 아래에서
    // 일어나 레이아웃 시프트가 보이지 않는다.
    const revealer = new IntersectionObserver(
      (entries) => {
        const near = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => entry.target.id);
        if (near.length) {
          setRevealedIds((prev) =>
            near.every((id) => prev.has(id))
              ? prev
              : new Set([...prev, ...near]),
          );
        }
      },
      { rootMargin: "0px 0px 25% 0px" },
    );
    for (const id of ids) {
      const element = document.getElementById(id);
      if (element) {
        spy.observe(element);
        revealer.observe(element);
      }
    }
    return () => {
      spy.disconnect();
      revealer.disconnect();
    };
  }, [idsKey]);

  // 탭 클릭은 전부 공개한다 — 미공개 자리표시자 높이로 앵커가 어긋나지 않게 flushSync로
  // DOM에 먼저 반영하고, 스크롤·해시 갱신은 앵커 기본 동작에 맡긴다.
  const revealAll = (id: string) => {
    flushSync(() => {
      setActiveId(id);
      setRevealedIds(new Set(idsKey.split(",")));
    });
  };

  return (
    <>
      <Flex
        as="nav"
        aria-label={ariaLabel}
        position="sticky"
        top={{ base: "x14", md: "x16" }}
        zIndex="z.sticky"
        bg="bg.layer-default"
        className="border-b border-stroke-neutral-weak"
      >
        {sections.map((section) => {
          const active = activeId === section.id;
          return (
            <a
              key={section.id}
              href={`#${section.id}`}
              aria-current={active ? "location" : undefined}
              onClick={() => revealAll(section.id)}
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
      </Flex>

      <VStack gap={0} alignItems="stretch">
        {sections.map((section, index) => {
          const revealed = revealedIds.has(section.id);
          return (
            <Box
              as="section"
              key={section.id}
              id={section.id}
              aria-label={section.label}
              pt={index === 0 ? "x6" : "x12"}
              pb="x12"
              style={{
                scrollMarginTop:
                  "calc(var(--spacing-x16) + var(--spacing-x14))",
                // 미공개 자리표시자 — 0 높이면 모든 섹션이 근접 판정에 걸려 지연이 무효가 된다.
                minHeight: revealed ? undefined : "50vh",
              }}
              className={cn(index > 0 && "border-t border-stroke-neutral-weak")}
            >
              {revealed ? section.content : null}
            </Box>
          );
        })}
      </VStack>
    </>
  );
}

export type { StickySection, StickySectionNavProps };
