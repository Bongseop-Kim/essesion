import {
  type ComponentPropsWithRef,
  type ReactNode,
  useEffect,
  useState,
} from "react";

import { cn } from "../cn";

/** size별 이니셜 폰트 — 하네스가 inline fontSize를 막으므로 text-t* 로 매핑 */
const initialFontSizes = {
  24: "text-t2",
  36: "text-t4",
  48: "text-t6",
  64: "text-t8",
  96: "text-t10",
} as const;

export type AvatarProps = Omit<ComponentPropsWithRef<"span">, "children"> & {
  src?: string;
  alt?: string;
  /** 이미지 부재·실패 시 이니셜 폴백의 원본 */
  name?: string;
  size?: keyof typeof initialFontSizes;
};

export function Avatar({
  src,
  alt,
  name,
  size = 36,
  className,
  style,
  ...props
}: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [src]);

  let content: ReactNode;
  if (src != null && !failed) {
    content = (
      <img
        className="size-full object-cover"
        src={src}
        alt={alt ?? name ?? ""}
        onError={() => setFailed(true)}
      />
    );
  } else if (name) {
    content = (
      <span
        className={cn(
          "font-medium text-fg-neutral-subtle",
          initialFontSizes[size],
        )}
      >
        {Array.from(name)[0]}
      </span>
    );
  } else {
    content = (
      <svg
        width="60%"
        height="60%"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
        className="text-fg-neutral-subtle"
      >
        <path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2.5c-4.6 0-8.5 2.4-8.5 5.5V21h17v-1c0-3.1-3.9-5.5-8.5-5.5Z" />
      </svg>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full border border-stroke-neutral-weak bg-bg-neutral-weak",
        className,
      )}
      style={{ width: size, height: size, ...style }}
      {...props}
    >
      {content}
    </span>
  );
}
