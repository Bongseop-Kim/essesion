import { type ComponentPropsWithRef, type ReactNode, useState } from "react";

import { cn } from "../cn";
import { AspectRatio } from "./aspect-ratio";
import { Flex } from "./flex";

const radii = {
  r2: "rounded-r2",
  r3: "rounded-r3",
  r4: "rounded-r4",
  0: "",
} as const;

export type ImageFrameProps = Omit<ComponentPropsWithRef<"img">, "children"> & {
  ratio?: number;
  borderRadius?: keyof typeof radii;
  stroke?: boolean;
  /** 로드 실패·소스 부재 시 렌더 (기본: 이미지 실루엣 면) */
  fallback?: ReactNode;
  /** 오버레이 슬롯 (Float 등) — 프레임이 absolute 컨텍스트를 제공 */
  children?: ReactNode;
};

export function ImageFrame({
  ratio = 4 / 3,
  borderRadius = "r2",
  stroke = false,
  fallback,
  children,
  className,
  src,
  alt = "",
  ...props
}: ImageFrameProps) {
  const [failed, setFailed] = useState(false);
  const showFallback = src == null || failed;

  return (
    <AspectRatio ratio={ratio} className={cn(radii[borderRadius], className)}>
      {showFallback ? (
        (fallback ?? <ImageFallback />)
      ) : (
        <img
          className="absolute inset-0 size-full object-cover"
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          {...props}
        />
      )}
      {stroke && (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 border border-stroke-neutral-weak",
            radii[borderRadius],
          )}
        />
      )}
      {children}
    </AspectRatio>
  );
}

function ImageFallback() {
  return (
    <Flex
      position="absolute"
      inset={0}
      align="center"
      justify="center"
      bg="bg.neutral-weak"
      className="text-fg-neutral-subtle"
    >
      <svg
        width="30%"
        height="30%"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M4 5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H4Zm0 12 4.5-6 3 4 2.5-3 4 5H4Zm4-8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Z" />
      </svg>
    </Flex>
  );
}
