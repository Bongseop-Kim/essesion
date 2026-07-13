import {
  type ComponentPropsWithRef,
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { cn } from "../cn";

export type ScrollFogProps = ComponentPropsWithRef<"div"> & {
  direction?: "vertical" | "horizontal";
  /** fog 길이(px) */
  size?: number;
};

/** 스크롤 여지가 있는 쪽 가장자리를 알파 마스크로 페이드 — 색이 아니라 마스크라 배경 무관. */
export function ScrollFog({
  direction = "vertical",
  size = 20,
  className,
  style,
  onScroll,
  children,
  ref,
  ...props
}: ScrollFogProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const update = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const scrollPos = direction === "vertical" ? el.scrollTop : el.scrollLeft;
    const maxScroll =
      direction === "vertical"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    const next = { start: scrollPos > 1, end: scrollPos < maxScroll - 1 };
    setEdges((prev) =>
      prev.start === next.start && prev.end === next.end ? prev : next,
    );
  }, [direction]);

  useEffect(() => {
    update();
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    for (const child of el.children) observer.observe(child);
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (node instanceof Element) observer.unobserve(node);
        }
        for (const node of record.addedNodes) {
          if (node instanceof Element) observer.observe(node);
        }
      }
      update();
    });
    mutations.observe(el, { childList: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
    };
  }, [update]);

  const axis = direction === "vertical" ? "to bottom" : "to right";
  const stops = [
    edges.start ? `transparent, black ${size}px` : "black",
    edges.end ? `black calc(100% - ${size}px), transparent` : "black",
  ].join(", ");
  const mask = `linear-gradient(${axis}, ${stops})`;

  const fogStyle: CSSProperties = {
    maskImage: mask,
    WebkitMaskImage: mask,
    ...style,
  };

  return (
    <div
      ref={setRef}
      className={cn(
        direction === "vertical"
          ? "overflow-y-auto"
          : "overflow-x-auto scrollbar-none",
        className,
      )}
      style={fogStyle}
      onScroll={(e) => {
        update();
        onScroll?.(e);
      }}
      {...props}
    >
      {children}
    </div>
  );
}
