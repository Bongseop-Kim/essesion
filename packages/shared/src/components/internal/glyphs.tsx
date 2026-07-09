import type { ComponentPropsWithRef } from "react";

/* 컴포넌트 구조상 필수 글리프(체크·셰브론 등)만 여기 둔다 — currentColor 상속.
   콘텐츠 아이콘은 앱 소유(@heroicons/react + Icon 래퍼). AGENTS.md 아이콘 절 참조. */

type GlyphProps = ComponentPropsWithRef<"svg">;

function glyphProps(props: GlyphProps) {
  return {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    ...props,
  } as const;
}

export function ChevronDownGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" {...glyphProps(props)}>
      <path d="M3 6l5 5 5-5" />
    </svg>
  );
}

export function ChevronRightGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" {...glyphProps(props)}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export function CheckGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" {...glyphProps(props)}>
      <path d="M3 8.5l3.5 3.5L13 5" />
    </svg>
  );
}

export function DashGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" {...glyphProps(props)}>
      <path d="M4 8h8" />
    </svg>
  );
}

export function XGlyph(props: GlyphProps) {
  return (
    <svg aria-hidden="true" {...glyphProps(props)}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}
