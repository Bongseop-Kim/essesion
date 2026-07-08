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
  ...props
}: ScrollFogProps) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = innerRef.current;
    if (!el) return;
    const scrollPos = direction === "vertical" ? el.scrollTop : el.scrollLeft;
    const maxScroll =
      direction === "vertical"
        ? el.scrollHeight - el.clientHeight
        : el.scrollWidth - el.clientWidth;
    setEdges({ start: scrollPos > 1, end: scrollPos < maxScroll - 1 });
  }, [direction]);

  useEffect(() => {
    update();
    const el = innerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
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
      ref={(node) => {
        innerRef.current = node;
      }}
      className={cn(
        direction === "vertical" ? "overflow-y-auto" : "overflow-x-auto",
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
