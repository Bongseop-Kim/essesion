import {
  createMyOrderReferenceImageReadUrl,
  type OrderItemOut,
} from "@essesion/api-client";
import { Badge } from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";

import { OrderItemSummary } from "@/entities/order-item/ui/order-item-summary";
import { claimItemTitle } from "@/features/claims/model/config";
import { reformServiceLabel } from "@/features/reform/model/reform";
import { resizedImage } from "@/shared/lib/image-url";
import { signedReadUrlQueryOptions } from "@/shared/lib/signed-read-url";

const ITEM_KIND_LABEL: Record<string, string> = {
  product: "상품",
  reform: "수선",
  custom: "맞춤",
  sample: "샘플",
};

/** 주문된 상품(OrderItemOut) 요약 — 주문 상세·클레임 상세가 같이 쓴다. */
export function OrderedItemSummary({
  orderId,
  item,
  claimBadge,
  referenceImageId,
}: {
  orderId: string;
  item: OrderItemOut;
  claimBadge?: ReactNode;
  /** 맞춤·샘플 썸네일로 쓸 첫 참고 이미지. */
  referenceImageId?: string;
}) {
  const product = productSnapshot(item.item_data);
  const reformKey = repairImageKey(item.item_data);
  const usesReference =
    item.item_type === "custom" || item.item_type === "sample";
  const reformImage = useQuery({
    ...signedReadUrlQueryOptions(reformKey ?? ""),
    enabled: reformKey !== null,
  });
  const referenceImage = useQuery({
    ...referenceImageUrlQueryOptions(orderId, referenceImageId ?? ""),
    enabled: usesReference && referenceImageId !== undefined,
  });
  const imageQuery = reformKey ? reformImage : referenceImage;
  const image = product
    ? resizedImage(product.image, 600)
    : imageQuery.isLoading
      ? null
      : { src: imageQuery.data };
  const reformLabel = reformKey ? reformLabelFromData(item.item_data) : null;
  const title = product?.name ?? claimItemTitle(item);

  return (
    <OrderItemSummary
      image={image}
      alt={title}
      badges={
        <>
          <Badge variant="outline">
            {ITEM_KIND_LABEL[item.item_type] ?? "상품"}
          </Badge>
          {claimBadge}
        </>
      }
      title={title}
      meta={
        reformLabel ??
        (product
          ? `${product.option ?? "FREE"} / ${item.quantity}개`
          : `${item.quantity}개`)
      }
      linePrice={item.unit_price * item.quantity}
      discount={item.line_discount_amount}
    />
  );
}

export function referenceImageUrlQueryOptions(
  orderId: string,
  imageId: string,
) {
  return {
    queryKey: ["order-reference-image-url", orderId, imageId] as const,
    queryFn: async () => {
      const response = await createMyOrderReferenceImageReadUrl({
        path: { order_id: orderId, image_id: imageId },
        throwOnError: true,
      });
      return response.data.read_url;
    },
    // 서버 URL TTL(15분)보다 짧게 둬 만료된 URL을 쓰지 않는다.
    staleTime: 10 * 60 * 1000,
  };
}

/** 주문 당시 저장된 상품 스냅샷(item_data.product·option) — 이관 데이터는 형태가 다를 수 있다. */
function productSnapshot(
  data: OrderItemOut["item_data"],
): { name: string; image: string | null; option: string | null } | null {
  const product = data?.product;
  if (typeof product !== "object" || product === null) return null;
  const { name, image } = product as { name?: unknown; image?: unknown };
  if (typeof name !== "string" || name === "") return null;
  const option = data?.option;
  const optionName =
    typeof option === "object" && option !== null
      ? (option as { name?: unknown }).name
      : null;
  return {
    name,
    image: typeof image === "string" ? image : null,
    option: typeof optionName === "string" && optionName ? optionName : null,
  };
}

function reformLabelFromData(data: OrderItemOut["item_data"]): string | null {
  try {
    return (
      reformServiceLabel(
        data as unknown as Parameters<typeof reformServiceLabel>[0],
      ) || null
    );
  } catch {
    // 형태가 다른 이관 데이터는 옵션 줄 없이 표시한다.
    return null;
  }
}

function repairImageKey(itemData: unknown): string | null {
  if (!itemData || typeof itemData !== "object" || !("tie" in itemData))
    return null;
  const tie = itemData.tie;
  if (!tie || typeof tie !== "object" || !("image" in tie)) return null;
  const image = tie.image;
  if (!image || typeof image !== "object" || !("object_key" in image))
    return null;
  return typeof image.object_key === "string" ? image.object_key : null;
}
