import type { ProductOut } from "@essesion/api-client";
import {
  AspectRatio,
  Box,
  ImageFrame,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import { Link } from "react-router";

const krw = new Intl.NumberFormat("ko-KR");

export function ProductCard({ product }: { product: ProductOut }) {
  return (
    <Box
      as={Link}
      to={`/shop/${product.id}`}
      display="block"
      className="group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
    >
      <VStack gap="x2">
        <ImageFrame
          ratio={1}
          borderRadius="r2"
          src={product.image}
          alt={product.name}
          loading="lazy"
        />
        <VStack gap="x0_5">
          <Text textStyle="bodySm" color="fg.neutral" maxLines={1}>
            {product.name}
          </Text>
          <Text textStyle="label" color="fg.neutral">
            ₩{krw.format(product.price)}
          </Text>
        </VStack>
      </VStack>
    </Box>
  );
}

export function ProductCardSkeleton() {
  return (
    <VStack gap="x2">
      <AspectRatio ratio={1} className="rounded-r2">
        <Skeleton
          width="100%"
          height="100%"
          radius={0}
          className="absolute inset-0"
        />
      </AspectRatio>
      <Skeleton width="70%" height={16} />
      <Skeleton width="40%" height={18} />
    </VStack>
  );
}
