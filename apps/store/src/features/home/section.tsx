import {
  HStack,
  LayoutContent,
  type LayoutContentProps,
  Text,
} from "@essesion/shared";
import { Link } from "react-router";

/** store 콘텐츠 컨테이너 — Header·Footer와 동일한 폭(LayoutContent medium=1280)으로 통일.
 *  full-bleed(히어로 모바일)가 필요하면 px 등 prop으로 덮어쓴다. */
export function Section(props: LayoutContentProps<"section">) {
  return <LayoutContent as="section" flexGrow={0} {...props} />;
}

/** 섹션 제목 + 선택적 "더보기" 링크. 원본의 pt-9/pt-14·pb-3 리듬 재현. */
export function SectionHeader({
  title,
  more,
  href,
}: {
  title: string;
  more?: string;
  href?: string;
}) {
  return (
    <HStack
      justify="space-between"
      align="flex-end"
      pt={{ base: "x9", md: "x14" }}
      pb="x3"
    >
      <Text as="h2" textStyle="title2">
        {title}
      </Text>
      {more && href ? (
        <Text as={Link} to={href} textStyle="caption" color="fg.neutral-subtle">
          {more} →
        </Text>
      ) : more ? (
        <Text textStyle="caption" color="fg.neutral-subtle">
          {more} →
        </Text>
      ) : null}
    </HStack>
  );
}
