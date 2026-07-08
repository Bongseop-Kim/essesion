import {
  AspectRatio,
  Avatar,
  Box,
  Divider,
  Float,
  HStack,
  ImageFrame,
  Skeleton,
  Tag,
  TagGroup,
  Text,
  VStack,
} from "@essesion/shared";

import { Section, SubSection } from "../section";

export function DisplaySection() {
  return (
    <Section title="디스플레이">
      <SubSection title="Avatar">
        <HStack gap="x4" align="end" wrap="wrap">
          <Avatar size={24} name="김되고" />
          <Avatar size={36} name="김되고" />
          <Avatar size={48} name="김되고" />
          <Avatar size={64} name="김되고" />
          <Avatar size={96} name="김되고" />
          <Avatar size={48} />
        </HStack>
      </SubSection>

      <SubSection title="Skeleton">
        <VStack gap="x4" align="start">
          <VStack gap="x2" width="full" maxWidth={320}>
            <Skeleton height={14} width="80%" />
            <Skeleton height={14} width="100%" />
            <Skeleton height={14} width="60%" />
          </VStack>
          <HStack gap="x3" align="start">
            <Skeleton width={96} height={96} radius="r4" />
            <VStack gap="x2">
              <Skeleton width={160} height={16} />
              <Skeleton width={120} height={14} />
              <Skeleton width={80} height={14} />
            </VStack>
          </HStack>
        </VStack>
      </SubSection>

      <SubSection title="Divider">
        <VStack gap="x4" width="full" maxWidth={320} align="start">
          <Text textStyle="bodySm">기본 가로 구분선 위</Text>
          <Divider />
          <Text textStyle="bodySm">inset 구분선 위</Text>
          <Divider inset />
          <HStack gap="x3" height={40}>
            <Text textStyle="bodySm">좌</Text>
            <Divider as="div" orientation="vertical" />
            <Text textStyle="bodySm">중</Text>
            <Divider as="div" orientation="vertical" inset />
            <Text textStyle="bodySm">우</Text>
          </HStack>
        </VStack>
      </SubSection>

      <SubSection title="TagGroup / Tag">
        <TagGroup>
          <Tag tone="brand">신상품</Tag>
          <Tag tone="neutral">무료배송</Tag>
          <Tag>재고 3개</Tag>
        </TagGroup>
      </SubSection>

      <SubSection title="AspectRatio">
        <Box width="full" maxWidth={320}>
          <AspectRatio ratio={4 / 3}>
            <Box position="absolute" inset={0} bg="bg.neutral-weak" />
          </AspectRatio>
        </Box>
      </SubSection>

      <SubSection title="ImageFrame">
        <Box width="full" maxWidth={320}>
          <ImageFrame
            src="https://picsum.photos/400/300"
            alt="데모 이미지"
            ratio={4 / 3}
            stroke
          >
            <Float placement="top-end" offsetX="x2" offsetY="x2">
              <Box bg="bg.brand-solid" px="x2" py="x0_5" borderRadius="r1">
                <Text textStyle="captionSm" color="fg.contrast">
                  NEW
                </Text>
              </Box>
            </Float>
          </ImageFrame>
        </Box>
      </SubSection>
    </Section>
  );
}
