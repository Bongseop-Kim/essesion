import type { ProductOptionOut, ProductOut } from "@essesion/api-client";
import {
  getProductOptions,
  getProductQueryKey,
  likeProductMutation,
  listProductsQueryKey,
  unlikeProductMutation,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  AspectRatio,
  Badge,
  Box,
  ContentPlaceholder,
  Divider,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  Tag,
  TagGroup,
  Text,
  VStack,
} from "@essesion/shared";
import {
  HeartIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useAuthGuard } from "@/features/auth";
import { useCartActions } from "@/features/cart";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";
import {
  categoryLabel,
  colorLabel,
  krw,
  materialLabel,
  patternLabel,
} from "./constants";

type CartAddDraft = {
  product: ProductOut;
  option: ProductOptionOut | null;
  quantity: number;
  goCart: boolean;
};

export function ShopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const sessionStatus = useSession((state) => state.status);
  const { requireAuth } = useAuthGuard();
  const productId = Number(id);
  const validProductId = Number.isInteger(productId) && productId > 0;
  const [selectedOptionId, setSelectedOptionId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [duplicateDraft, setDuplicateDraft] = useState<CartAddDraft | null>(
    null,
  );
  const [addedDialogOpen, setAddedDialogOpen] = useState(false);

  const productQuery = useQuery({
    ...getProductOptions({
      path: { product_id: validProductId ? productId : 0 },
    }),
    enabled: validProductId,
  });
  const product = productQuery.data;
  const options = product?.options ?? [];
  const hasOptions = options.length > 0;
  const selectedOption = options.find(
    (option) => option.id === selectedOptionId,
  );
  const selectedStock = selectedOption?.stock ?? product?.stock ?? null;
  const soldOut = product
    ? hasOptions
      ? options.every((option) => option.stock === 0)
      : product.stock === 0
    : false;
  const canSubmit =
    product != null &&
    !soldOut &&
    (!hasOptions || selectedOption != null) &&
    (selectedStock == null || selectedStock >= quantity);
  const unitPrice = product
    ? product.price + (selectedOption?.additional_price ?? 0)
    : 0;
  const totalPrice = unitPrice * quantity;

  const likeProduct = useMutation(likeProductMutation());
  const unlikeProduct = useMutation(unlikeProductMutation());
  const cartActions = useCartActions();

  useEffect(() => {
    setSelectedOptionId("");
    setQuantity(1);
  }, [product?.id]);

  useEffect(() => {
    setQuantity(1);
  }, [selectedOptionId]);

  const detailImages = useMemo(
    () =>
      product
        ? product.detail_images && product.detail_images.length > 0
          ? product.detail_images
          : [product.image]
        : [],
    [product],
  );

  const requireLogin = () => {
    return requireAuth({ path: `${location.pathname}${location.search}` });
  };

  const refreshProductQueries = async () => {
    if (!product) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: getProductQueryKey({ path: { product_id: product.id } }),
      }),
      queryClient.invalidateQueries({ queryKey: listProductsQueryKey() }),
    ]);
  };

  const toggleLike = async () => {
    if (!product || !requireLogin()) return;
    try {
      if (product.is_liked) {
        await unlikeProduct.mutateAsync({ path: { product_id: product.id } });
      } else {
        await likeProduct.mutateAsync({ path: { product_id: product.id } });
      }
      await refreshProductQueries();
    } catch {
      snackbar("관심 상품을 변경하지 못했습니다.");
    }
  };

  const validateCartDraft = (goCart: boolean): CartAddDraft | null => {
    if (!product || sessionStatus === "loading") return null;
    if (canSubmit) {
      return { product, option: selectedOption ?? null, quantity, goCart };
    }
    snackbar(
      hasOptions ? "옵션을 선택해 주세요." : "구매할 수 없는 상품입니다.",
    );
    return null;
  };

  const performAddToCart = async (draft: CartAddDraft) => {
    try {
      await cartActions.addProduct({
        product: draft.product,
        option: draft.option,
        quantity: draft.quantity,
      });
      if (draft.goCart) {
        navigate("/cart");
      } else {
        setAddedDialogOpen(true);
      }
    } catch {
      snackbar("장바구니에 담지 못했습니다.");
    }
  };

  const addToCart = async (goCart = false) => {
    const draft = validateCartDraft(goCart);
    if (!draft) return;
    try {
      const existingQuantity = await cartActions.currentQuantity(
        draft.product.id,
        draft.option?.id,
      );
      const stock = draft.option?.stock ?? draft.product.stock ?? null;
      if (stock != null && existingQuantity + draft.quantity > stock) {
        snackbar(`재고는 ${stock}개까지 담을 수 있습니다.`);
        return;
      }
      if (existingQuantity > 0) {
        setDuplicateDraft(draft);
        return;
      }
      await performAddToCart(draft);
    } catch {
      snackbar("장바구니 상태를 확인하지 못했습니다.");
    }
  };

  if (!validProductId) {
    return <MissingProduct onBack={() => navigate("/shop")} />;
  }

  if (productQuery.isPending) {
    return <ProductDetailSkeleton />;
  }

  if (productQuery.isError || !product) {
    return <MissingProduct onBack={() => navigate("/shop")} />;
  }

  return (
    <>
      <ContentLayout
        breadcrumbs={shopCrumbs(product.name)}
        sidebar={
          <ProductSummary
            product={product}
            options={options}
            selectedOptionId={selectedOptionId}
            onSelectedOptionChange={setSelectedOptionId}
            quantity={quantity}
            onQuantityChange={setQuantity}
            selectedStock={selectedStock}
            unitPrice={unitPrice}
            totalPrice={totalPrice}
            soldOut={soldOut}
          />
        }
        actionBar={
          <ProductActionBar
            liked={product.is_liked ?? false}
            likes={product.likes ?? 0}
            likeLoading={likeProduct.isPending || unlikeProduct.isPending}
            cartLoading={cartActions.isPending}
            disabled={sessionStatus === "loading" || soldOut}
            onLike={toggleLike}
            onAddToCart={() => addToCart(false)}
            onBuy={() => addToCart(true)}
          />
        }
        detail={<ProductDetail product={product} detailImages={detailImages} />}
      >
        <ImageFrame
          ratio={1}
          src={product.image}
          alt={product.name}
          borderRadius="r3"
          fit="cover"
          stroke
        />
      </ContentLayout>

      <AlertDialog
        open={duplicateDraft != null}
        onOpenChange={(open) => {
          if (!open) setDuplicateDraft(null);
        }}
        title="이미 장바구니에 있는 상품입니다"
        description="선택한 수량을 추가로 담을까요?"
        primaryActionProps={{
          children: duplicateDraft?.goCart ? "추가하고 이동" : "추가로 담기",
          onClick: () => {
            if (!duplicateDraft) return;
            void performAddToCart(duplicateDraft);
          },
        }}
        secondaryActionProps={{
          children: "취소",
          variant: "neutralOutline",
        }}
      />

      <AlertDialog
        open={addedDialogOpen}
        onOpenChange={setAddedDialogOpen}
        title="장바구니에 담았습니다"
        description="계속 쇼핑하거나 장바구니로 이동할 수 있습니다."
        primaryActionProps={{
          children: "장바구니로 이동",
          onClick: () => navigate("/cart"),
        }}
        secondaryActionProps={{
          children: "계속 쇼핑",
          variant: "neutralOutline",
        }}
      />
    </>
  );
}

function ProductSummary({
  product,
  options,
  selectedOptionId,
  onSelectedOptionChange,
  quantity,
  onQuantityChange,
  selectedStock,
  unitPrice,
  totalPrice,
  soldOut,
}: {
  product: ProductOut;
  options: ProductOptionOut[];
  selectedOptionId: string;
  onSelectedOptionChange: (value: string) => void;
  quantity: number;
  onQuantityChange: (value: number) => void;
  selectedStock: number | null;
  unitPrice: number;
  totalPrice: number;
  soldOut: boolean;
}) {
  const hasOptions = options.length > 0;
  const maxQuantity = selectedStock ?? undefined;
  const decrease = () => onQuantityChange(Math.max(1, quantity - 1));
  const increase = () =>
    onQuantityChange(
      maxQuantity === undefined
        ? quantity + 1
        : Math.min(maxQuantity, quantity + 1),
    );

  return (
    <VStack gap="x5" alignItems="stretch">
      <VStack gap="x3">
        <HStack gap="x2" wrap>
          {product.code ? (
            <Badge variant="outline">{product.code}</Badge>
          ) : null}
          {soldOut ? (
            <Badge variant="solid" tone="critical">
              품절
            </Badge>
          ) : null}
        </HStack>
        <Text as="h1" textStyle="title1">
          {product.name}
        </Text>
        <Text textStyle="title2">₩{krw.format(product.price)}</Text>
        <TagGroup>
          <Tag>#{categoryLabel(product.category)}</Tag>
          <Tag>#{colorLabel(product.color)}</Tag>
          <Tag>#{patternLabel(product.pattern)}</Tag>
          <Tag>#{materialLabel(product.material)}</Tag>
        </TagGroup>
        <Text as="p" textStyle="bodySm" color="fg.neutral-muted">
          {product.info}
        </Text>
      </VStack>

      <Divider />

      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title3">
          구매 옵션
        </Text>
        {hasOptions ? (
          <SelectBox
            value={selectedOptionId}
            onValueChange={(value) => onSelectedOptionChange(String(value))}
            aria-label={product.option_label ?? "옵션"}
          >
            {options.map((option) => (
              <SelectBoxItem
                key={option.id}
                value={option.id}
                label={optionLabel(option)}
                description={optionDescription(option)}
                disabled={option.stock === 0}
              />
            ))}
          </SelectBox>
        ) : null}

        <HStack justify="space-between" gap="x4">
          <Text textStyle="labelSm" color="fg.neutral-muted">
            수량
          </Text>
          <HStack gap="x2">
            <ActionButton
              type="button"
              variant="neutralOutline"
              size="xsmall"
              iconOnly
              aria-label="수량 줄이기"
              disabled={quantity <= 1}
              onClick={decrease}
            >
              <Icon svg={<MinusIcon />} size={16} />
            </ActionButton>
            <Box minWidth="x12">
              <Text as="span" textStyle="label" align="center" display="block">
                {quantity}
              </Text>
            </Box>
            <ActionButton
              type="button"
              variant="neutralOutline"
              size="xsmall"
              iconOnly
              aria-label="수량 늘리기"
              disabled={maxQuantity !== undefined && quantity >= maxQuantity}
              onClick={increase}
            >
              <Icon svg={<PlusIcon />} size={16} />
            </ActionButton>
          </HStack>
        </HStack>

        <VStack gap="x2">
          <HStack justify="space-between">
            <Text textStyle="bodySm" color="fg.neutral-muted">
              단가
            </Text>
            <Text textStyle="bodySm">₩{krw.format(unitPrice)}</Text>
          </HStack>
          <HStack justify="space-between">
            <Text textStyle="label">합계</Text>
            <Text textStyle="title3">₩{krw.format(totalPrice)}</Text>
          </HStack>
        </VStack>
      </VStack>
    </VStack>
  );
}

function ProductActionBar({
  liked,
  likes,
  likeLoading,
  cartLoading,
  disabled,
  onLike,
  onAddToCart,
  onBuy,
}: {
  liked: boolean;
  likes: number;
  likeLoading: boolean;
  cartLoading: boolean;
  disabled: boolean;
  onLike: () => void;
  onAddToCart: () => void;
  onBuy: () => void;
}) {
  return (
    <Grid templateColumns="3.25rem minmax(0, 1fr) minmax(0, 1fr)" gap="x2">
      <Box
        as={ActionButton}
        type="button"
        variant={liked ? "brandSolid" : "neutralWeak"}
        size="large"
        iconOnly
        aria-label={liked ? "관심 상품 해제" : "관심 상품 추가"}
        loading={likeLoading}
        onClick={onLike}
      >
        <VStack align="center" gap="x0_5">
          <Icon svg={<HeartIcon />} size={18} />
          <Text
            textStyle="captionSm"
            color={liked ? "fg.contrast" : "fg.neutral-muted"}
            align="center"
          >
            {likes}
          </Text>
        </VStack>
      </Box>
      <Box
        as={ActionButton}
        type="button"
        variant="neutralOutline"
        size="large"
        width="full"
        disabled={disabled}
        loading={cartLoading}
        onClick={onAddToCart}
      >
        <Icon svg={<ShoppingBagIcon />} size={18} />
        장바구니
      </Box>
      <Box
        as={ActionButton}
        type="button"
        size="large"
        width="full"
        disabled={disabled}
        loading={cartLoading}
        onClick={onBuy}
      >
        구매하기
      </Box>
    </Grid>
  );
}

function ProductDetail({
  product,
  detailImages,
}: {
  product: ProductOut;
  detailImages: string[];
}) {
  return (
    <VStack gap="x8" alignItems="stretch">
      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          상품 정보
        </Text>
        <Grid columns={{ base: 1, md: 2 }} gap="x3">
          <Spec label="상품 코드" value={product.code ?? "-"} />
          <Spec label="분류" value={categoryLabel(product.category)} />
          <Spec label="색상" value={colorLabel(product.color)} />
          <Spec label="패턴" value={patternLabel(product.pattern)} />
          <Spec label="소재" value={materialLabel(product.material)} />
          <Spec label="배송" value="영업일 기준 3~4일" />
        </Grid>
      </VStack>

      <VStack gap="x4" alignItems="stretch">
        <Text as="h2" textStyle="title2">
          상세 이미지
        </Text>
        <VStack gap="x4" alignItems="stretch">
          {detailImages.map((src, index) => (
            <ImageFrame
              key={`${src}-${index}`}
              ratio={4 / 3}
              src={src}
              alt={`${product.name} 상세 이미지 ${index + 1}`}
              fit="contain"
              borderRadius="r2"
              stroke
            />
          ))}
        </VStack>
      </VStack>
    </VStack>
  );
}

function Spec({ label, value }: { label: string; value: string }) {
  return (
    <HStack justify="space-between" gap="x4" py="x3">
      <Text textStyle="bodySm" color="fg.neutral-muted">
        {label}
      </Text>
      <Text textStyle="labelSm">{value}</Text>
    </HStack>
  );
}

function ProductDetailSkeleton() {
  // 상세 레이아웃과 같은 형태로 배치 — 스피너 대신 시프트 없는 초기 로딩.
  return (
    <ContentLayout
      breadcrumbs={shopCrumbs()}
      sidebar={
        <VStack gap="x5" alignItems="stretch">
          <VStack gap="x3">
            <Skeleton width="70%" height={30} />
            <Skeleton width="40%" height={26} />
            <Skeleton width="90%" height={19} />
            <Skeleton width="60%" height={19} />
          </VStack>
          <Skeleton width="100%" height={44} radius="r2" />
        </VStack>
      }
    >
      <AspectRatio ratio={1} className="rounded-r3">
        <Skeleton
          width="100%"
          height="100%"
          radius={0}
          className="absolute inset-0"
        />
      </AspectRatio>
    </ContentLayout>
  );
}

function MissingProduct({ onBack }: { onBack: () => void }) {
  return (
    <ContentLayout breadcrumbs={shopCrumbs()}>
      <ContentPlaceholder
        title="상품을 찾을 수 없습니다"
        action={
          <ActionButton type="button" variant="neutralOutline" onClick={onBack}>
            스토어로 이동
          </ActionButton>
        }
      />
    </ContentLayout>
  );
}

function shopCrumbs(current?: string) {
  return [
    { label: "홈", href: "/" },
    current ? { label: "스토어", href: "/shop" } : { label: "스토어" },
    ...(current ? [{ label: current }] : []),
  ];
}

function optionLabel(option: ProductOptionOut) {
  return option.additional_price > 0
    ? `${option.name} (+₩${krw.format(option.additional_price)})`
    : option.name;
}

function optionDescription(option: ProductOptionOut) {
  if (option.stock === 0) return "품절";
  if (option.stock != null && option.stock <= 5)
    return `${option.stock}개 남음`;
  return undefined;
}
