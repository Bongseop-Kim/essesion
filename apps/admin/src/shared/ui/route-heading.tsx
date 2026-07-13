import { Text, VStack } from "@essesion/shared";
import { useLayoutEffect, useRef } from "react";
import { useLocation } from "react-router";

export type RouteHeadingProps = {
  title: string;
  description?: string;
};

export function RouteHeading({ title, description }: RouteHeadingProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const location = useLocation();

  useLayoutEffect(() => {
    document.title = `${title} | ESSE SION 관리자`;
    headingRef.current?.focus({ preventScroll: true });
  }, [location.key, location.pathname, title]);

  return (
    <VStack gap="x2">
      <Text
        ref={headingRef}
        tabIndex={-1}
        as="h1"
        textStyle="title1"
        className="focus:outline-none"
      >
        {title}
      </Text>
      {description !== undefined && (
        <Text textStyle="bodySm" color="fg.neutral-muted">
          {description}
        </Text>
      )}
    </VStack>
  );
}
