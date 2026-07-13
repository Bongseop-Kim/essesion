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

// JIT는 리터럴 클래스가 필요 — `object-${fit}` 보간 금지, 정적 맵으로.
const objectFits = {
  cover: "object-cover",
  contain: "object-contain",
} as const;

export type ImageFrameProps = Omit<ComponentPropsWithRef<"img">, "children"> & {
  ratio?: number;
  borderRadius?: keyof typeof radii;
  /** cover=꽉 채워 크롭(기본), contain=전체 보이게 레터박스(로고·썸네일) */
  fit?: keyof typeof objectFits;
  stroke?: boolean;
  /** ratio 대신 positioned 부모를 꽉 채움 — 높이가 외부에서 정해지는 가변 셀(예: bento 그리드)용 */
  fill?: boolean;
  /** 로드 실패·소스 부재 시 렌더 (기본: 이미지 실루엣 면) */
  fallback?: ReactNode;
  /** 오버레이 슬롯 (Float 등) — 프레임이 absolute 컨텍스트를 제공 */
  children?: ReactNode;
};

export function ImageFrame({
  ratio = 4 / 3,
  borderRadius = "r2",
  fit = "cover",
  stroke = false,
  fill = false,
  fallback,
  children,
  className,
  src,
  alt = "",
  onError,
  ...props
}: ImageFrameProps) {
  const [failedSrc, setFailedSrc] = useState<string>();
  const showFallback = src == null || failedSrc === src;

  const inner = (
    <>
      {showFallback ? (
        (fallback ?? <ImageFallback />)
      ) : (
        <img
          className={cn("absolute inset-0 size-full", objectFits[fit])}
          src={src}
          alt={alt}
          {...props}
          onError={(event) => {
            setFailedSrc(src);
            onError?.(event);
          }}
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
    </>
  );

  if (fill) {
    return (
      <div
        className={cn(
          "absolute inset-0 overflow-hidden",
          radii[borderRadius],
          className,
        )}
      >
        {inner}
      </div>
    );
  }

  return (
    <AspectRatio ratio={ratio} className={cn(radii[borderRadius], className)}>
      {inner}
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
