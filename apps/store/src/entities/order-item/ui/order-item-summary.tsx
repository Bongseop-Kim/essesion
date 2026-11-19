import {
  AspectRatio,
  Grid,
  HStack,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import type { ReactNode } from "react";

import { krw } from "@/shared/lib/format";

// 금액은 쉼표 사이에서 줄이 바뀌지 않게 — 좁으면 원가와 할인가 사이에서 바뀐다
const noWrap = { whiteSpace: "nowrap" } as const;

/**
 * 장바구니·주문서·주문 상세·클레임 상세가 같이 쓰는 상품 한 줄 요약.
 * 썸네일 6rem + 배지 + 이름 + 옵션 줄 + 금액. 카드 테두리와 아래 액션은 호출자가 감싼다.
 */
export function OrderItemSummary({
  image,
  alt,
  badges,
  title,
  meta,
  linePrice,
  discount = 0,
  couponName,
  trailing,
  children,
}: {
  /** ImageFrame에 펼쳐 넣을 props. `null`이면 아직 불러오는 중이라 Skeleton. */
  image: { src: string | undefined; fallbackSrc?: string } | null;
  alt: string;
  badges?: ReactNode;
  title: string;
  meta?: ReactNode;
  /** 할인 전 줄 금액. 없으면 금액 줄을 그리지 않는다. */
  linePrice?: number;
  discount?: number;
  couponName?: string | null;
  trailing?: ReactNode;
  /** 금액 아래, 같은 열에 붙는 보조 줄(차단 사유 등). */
  children?: ReactNode;
}) {
  return (
    <Grid templateColumns="6rem minmax(0, 1fr)" gap="x4">
      {image ? (
        <ImageFrame
          ratio={1}
          {...image}
          alt={alt}
          borderRadius="r2"
          fit="cover"
          stroke
        />
      ) : (
        <AspectRatio ratio={1} className="rounded-r2">
          <Skeleton
            width="100%"
            height="100%"
            radius={0}
            className="absolute inset-0"
          />
        </AspectRatio>
      )}
      <HStack justify="space-between" gap="x3" align="flex-start">
        <VStack gap="x1" minWidth={0}>
          {badges ? (
            <HStack gap="x2" wrap>
              {badges}
            </HStack>
          ) : null}
          <Text textStyle="label" maxLines={2}>
            {title}
          </Text>
          {meta ? (
            <Text textStyle="caption" color="fg.neutral-muted">
              {meta}
            </Text>
          ) : null}
          {children}
          {linePrice !== undefined ? (
            <OrderItemPrice
              linePrice={linePrice}
              discount={discount}
              couponName={couponName}
            />
          ) : null}
        </VStack>
        {trailing}
      </HStack>
    </Grid>
  );
}

function OrderItemPrice({
  linePrice,
  discount,
  couponName,
}: {
  linePrice: number;
  discount: number;
  couponName?: string | null;
}) {
  if (discount <= 0) {
    return (
      <Text textStyle="label" style={noWrap}>
        {krw.format(linePrice)}원
      </Text>
    );
  }
  return (
    <VStack gap="x0_5" alignItems="flex-start">
      <HStack gap="x2" wrap>
        <Text
          textStyle="caption"
          color="fg.neutral-muted"
          style={{ ...noWrap, textDecoration: "line-through" }}
        >
          {krw.format(linePrice)}원
        </Text>
        <Text textStyle="label" color="fg.critical" style={noWrap}>
          {krw.format(Math.max(0, linePrice - discount))}원
        </Text>
      </HStack>
      {couponName ? (
        <Text textStyle="captionSm" color="fg.neutral-muted">
          {couponName} 적용
        </Text>
      ) : null}
    </VStack>
  );
}
