import { Text, VStack } from "@essesion/shared";
import type { ReactNode } from "react";

/** 상세 "정보" 탭 장문 가이드(수선·주문제작)의 섹션 조각 — pen 시안 R-B v8·C3 v2 공통 형식. */
export type SurfaceColor =
  | "bg.layer-default"
  | "bg.neutral-weak"
  | "bg.neutral-inverted";

export function GuideSection({
  bg = "bg.layer-default",
  pt = "x16",
  pb = "x16",
  alignItems = "stretch",
  ...props
}: {
  id?: string;
  bg?: SurfaceColor;
  pt?: "x10" | "x14" | "x16";
  pb?: "x10" | "x14" | "x16";
  alignItems?: "stretch" | "center";
  children: ReactNode;
}) {
  return (
    <VStack
      gap="x6"
      alignItems={alignItems}
      // lg 미만은 단일 컬럼 — 섹션 배경을 LayoutContent 거터(x4/x6) 밖 화면 끝까지 펼치고,
      // 같은 값만큼 안쪽 여백을 줘 본문 정렬은 그대로 둔다. lg는 상세 컬럼 안 카드처럼 둔다.
      className="-mx-x4 md:-mx-x6 lg:mx-0"
      px={{ base: "x4", md: "x6", lg: "x5" }}
      pt={pt}
      pb={pb}
      bg={bg}
      // 상단 sticky 헤더+탭 아래로 앵커가 내려오게 — StickySectionNav와 같은 오프셋
      style={{
        scrollMarginTop: "calc(var(--spacing-x16) + var(--spacing-x14))",
      }}
      {...props}
    />
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text textStyle="labelSm" color="fg.neutral-muted">
      {children}
    </Text>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h3" textStyle="display1" className="whitespace-pre-line">
      {children}
    </Text>
  );
}

export function SubTitle({ children }: { children: ReactNode }) {
  return (
    <Text as="h4" textStyle="title2" mt="x4">
      {children}
    </Text>
  );
}

export function Lead({ children }: { children: ReactNode }) {
  return (
    <Text
      textStyle="body"
      color="fg.neutral-muted"
      className="whitespace-pre-line"
    >
      {children}
    </Text>
  );
}
