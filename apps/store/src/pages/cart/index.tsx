import type {
  CartItemIn,
  ProductOut,
  UserCouponOut,
} from "@essesion/api-client";
import {
  getProductOptions,
  listMyCouponsOptions,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  AspectRatio,
  Badge,
  Box,
  Checkbox,
  ContentPlaceholder,
  Divider,
  Grid,
  HStack,
  Icon,
  ImageFrame,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import {
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";

import {
  productUnitPrice,
  selectedOption,
  useCartActions,
  useCartItems,
} from "@/features/cart";
import {
  CouponSelectModal,
  couponDiscount,
  couponLabel,
} from "@/features/coupon";
import { krw } from "@/pages/shop/constants";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";

type CartViewItem = {
  input: CartItemIn;
  product: ProductOut | null;
  appliedCoupon: UserCouponOut | null;
  unavailable: boolean;
};

export function CartPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const sessionStatus = useSession((state) => state.status);
  const isAuthed = sessionStatus === "authenticated";
  const cart = useCartItems();
  const cartActions = useCartActions();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [couponItemId, setCouponItemId] = useState<string | null>(null);
  const [optionItemId, setOptionItemId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    ids: string[];
    title: string;
    description: string;
  } | null>(null);
  const selectionInitialized = useRef(false);

  const productIds = useMemo(
    () =>
      Array.from(
        new Set(
          cart.inputs
            .map((item) => item.product_id)
            .filter((id): id is number => typeof id === "number"),
        ),
      ),
    [cart.inputs],
  );
  const productQueries = useQueries({
    queries: productIds.map((productId) =>
      getProductOptions({ path: { product_id: productId } }),
    ),
  });
  const productsById = useMemo(() => {
    const products = new Map<number, ProductOut>();
    productQueries.forEach((query) => {
      if (query.data) products.set(query.data.id, query.data);
    });
    return products;
  }, [productQueries]);

  const couponsQuery = useQuery({
    ...listMyCouponsOptions({ query: { active_only: true } }),
    enabled: isAuthed,
  });
  const coupons = couponsQuery.data ?? [];

  const items = useMemo<CartViewItem[]>(
    () =>
      cart.inputs.map((input) => {
        const serverItem = cart.serverItems.find(
          (item) => item.item_id === input.item_id,
        );
        const product =
          typeof input.product_id === "number"
            ? (productsById.get(input.product_id) ??
              serverItem?.product ??
              null)
            : null;
        const appliedCoupon =
          serverItem?.applied_coupon ??
          coupons.find(
            (coupon) => coupon.id === input.applied_user_coupon_id,
          ) ??
          null;
        return {
          input,
          product,
          appliedCoupon,
          unavailable: input.item_type === "product" && !product,
        };
      }),
    [cart.inputs, cart.serverItems, coupons, productsById],
  );

  const itemIds = useMemo(
    () => items.map((item) => item.input.item_id),
    [items],
  );

  useEffect(() => {
    if (itemIds.length === 0) {
      selectionInitialized.current = false;
      setSelectedIds([]);
      return;
    }
    setSelectedIds((current) => {
      const valid = current.filter((id) => itemIds.includes(id));
      const next = selectionInitialized.current ? valid : itemIds;
      if (!selectionInitialized.current) {
        selectionInitialized.current = true;
      }
      return sameStringArray(current, next) ? current : next;
    });
  }, [itemIds]);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedIds.includes(item.input.item_id)),
    [items, selectedIds],
  );
  const totals = useMemo(() => calculateTotals(selectedItems), [selectedItems]);
  const couponItem = useMemo(
    () => items.find((item) => item.input.item_id === couponItemId) ?? null,
    [couponItemId, items],
  );
  const optionItem = useMemo(
    () => items.find((item) => item.input.item_id === optionItemId) ?? null,
    [items, optionItemId],
  );
  const isAllChecked =
    itemIds.length > 0 && selectedIds.length === itemIds.length;
  const isPartiallyChecked =
    selectedIds.length > 0 && selectedIds.length < itemIds.length;
  const productLoading =
    productQueries.some((query) => query.isPending) && items.length > 0;
  const showLoading = cart.isPending || productLoading;

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? itemIds : []);
  };

  const toggleItem = (itemId: string, checked: boolean) => {
    setSelectedIds((current) =>
      checked
        ? current.includes(itemId)
          ? current
          : [...current, itemId]
        : current.filter((id) => id !== itemId),
    );
  };

  const removeItems = async (ids: readonly string[]) => {
    try {
      await cartActions.removeItems(ids);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      snackbar("장바구니에서 삭제했습니다.");
    } catch {
      snackbar("삭제하지 못했습니다.");
    }
  };

  const orderSelected = () => {
    if (selectedIds.length === 0) {
      snackbar("주문할 상품을 선택해 주세요.");
      return;
    }
    if (!isAuthed) {
      navigate("/login", { state: { from: location.pathname } });
      return;
    }
    navigate("/order/order-form", { state: { cartItemIds: selectedIds } });
  };

  const retry = () => {
    void cart.refetch();
  };

  return (
    <ContentLayout
      breadcrumbs={cartCrumbs()}
      sidebar={
        <CartSummary totals={totals} selectedCount={selectedIds.length} />
      }
      actionBar={
        <Box
          as={ActionButton}
          type="button"
          size="large"
          width="full"
          disabled={selectedIds.length === 0}
          onClick={orderSelected}
        >
          <Icon svg={<ShoppingBagIcon />} size={18} />
          {selectedIds.length > 0
            ? `₩${krw.format(totals.total)} 주문하기`
            : "주문하기"}
        </Box>
      }
      detail={<CartRecommendations onShop={() => navigate("/shop")} />}
    >
      <VStack gap="x5" alignItems="stretch">
        <VStack gap="x2">
          <Text as="h1" textStyle="title1">
            장바구니
          </Text>
          <Text as="p" textStyle="body" color="fg.neutral-muted">
            주문할 항목을 선택하고 수량과 쿠폰을 확인해 주세요.
          </Text>
        </VStack>

        {showLoading ? (
          <CartSkeleton />
        ) : cart.isError ? (
          <ContentPlaceholder
            title="장바구니를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={retry}
              >
                다시 시도
              </ActionButton>
            }
          />
        ) : items.length === 0 ? (
          <ContentPlaceholder
            title="장바구니가 비어 있습니다"
            description="스토어에서 상품을 둘러보고 장바구니에 담아보세요."
            action={
              <ActionButton
                type="button"
                variant="neutralOutline"
                onClick={() => navigate("/shop")}
              >
                스토어로 이동
              </ActionButton>
            }
          />
        ) : (
          <>
            <CartToolbar
              checked={isAllChecked}
              indeterminate={isPartiallyChecked}
              selectedCount={selectedIds.length}
              totalCount={items.length}
              onToggleAll={toggleAll}
              onRemoveSelected={() => {
                if (selectedIds.length === 0) {
                  snackbar("삭제할 항목을 선택해 주세요.");
                  return;
                }
                setDeleteTarget({
                  ids: selectedIds,
                  title: "선택 항목 삭제",
                  description: "선택한 항목을 장바구니에서 삭제할까요?",
                });
              }}
            />
            <VStack gap="x3" alignItems="stretch">
              {items.map((item) => (
                <CartItemCard
                  key={item.input.item_id}
                  item={item}
                  checked={selectedIds.includes(item.input.item_id)}
                  busy={cartActions.isPending}
                  isAuthed={isAuthed}
                  onCheckedChange={(checked) =>
                    toggleItem(item.input.item_id, checked)
                  }
                  onOptionChange={() => {
                    if (item.input.item_type !== "product") {
                      snackbar("수선 옵션 변경은 수선 화면에서 연결됩니다.");
                      return;
                    }
                    setOptionItemId(item.input.item_id);
                  }}
                  onCouponChange={() => {
                    if (!isAuthed) {
                      navigate("/login", {
                        state: { from: location.pathname },
                      });
                      return;
                    }
                    setCouponItemId(item.input.item_id);
                  }}
                  onRemove={() =>
                    setDeleteTarget({
                      ids: [item.input.item_id],
                      title: "항목 삭제",
                      description: "이 항목을 장바구니에서 삭제할까요?",
                    })
                  }
                />
              ))}
            </VStack>
          </>
        )}
      </VStack>

      <CouponSelectModal
        coupons={coupons}
        selected={couponItem?.appliedCoupon ?? null}
        loading={couponsQuery.isFetching}
        error={couponsQuery.isError}
        open={couponItem != null}
        onOpenChange={(open) => {
          if (!open) setCouponItemId(null);
        }}
        onApply={async (coupon) => {
          if (!couponItem) return;
          try {
            await cartActions.applyCoupon(couponItem.input.item_id, coupon);
            snackbar(
              coupon ? "쿠폰을 적용했습니다." : "쿠폰 적용을 해제했습니다.",
            );
            setCouponItemId(null);
          } catch {
            snackbar("쿠폰을 변경하지 못했습니다.");
          }
        }}
      />

      <OptionModal
        item={optionItem}
        open={optionItem != null}
        onOpenChange={(open) => {
          if (!open) setOptionItemId(null);
        }}
        onApply={async ({ optionId, quantity }) => {
          if (!optionItem?.product) return;
          const option = selectedOption(optionItem.product, optionId);
          try {
            await cartActions.updateProductOption({
              itemId: optionItem.input.item_id,
              product: optionItem.product,
              option,
              quantity,
            });
            snackbar("옵션을 변경했습니다.");
            setOptionItemId(null);
          } catch {
            snackbar("옵션을 변경하지 못했습니다.");
          }
        }}
      />

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={deleteTarget?.title ?? "삭제"}
        description={deleteTarget?.description}
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          onClick: () => {
            if (deleteTarget) void removeItems(deleteTarget.ids);
          },
        }}
        secondaryActionProps={{
          children: "취소",
          variant: "neutralOutline",
        }}
      />
    </ContentLayout>
  );
}

function CartToolbar({
  checked,
  indeterminate,
  selectedCount,
  totalCount,
  onToggleAll,
  onRemoveSelected,
}: {
  checked: boolean;
  indeterminate: boolean;
  selectedCount: number;
  totalCount: number;
  onToggleAll: (checked: boolean) => void;
  onRemoveSelected: () => void;
}) {
  return (
    <HStack justify="space-between" gap="x3" wrap>
      <Checkbox
        checked={checked}
        indeterminate={indeterminate}
        onChange={(event) => onToggleAll(event.currentTarget.checked)}
        label={`전체 선택 (${selectedCount}/${totalCount})`}
      />
      <ActionButton
        type="button"
        variant="neutralOutline"
        size="small"
        disabled={selectedCount === 0}
        onClick={onRemoveSelected}
      >
        <Icon svg={<TrashIcon />} size={16} />
        선택 삭제
      </ActionButton>
    </HStack>
  );
}

function CartItemCard({
  item,
  checked,
  busy,
  isAuthed,
  onCheckedChange,
  onOptionChange,
  onCouponChange,
  onRemove,
}: {
  item: CartViewItem;
  checked: boolean;
  busy: boolean;
  isAuthed: boolean;
  onCheckedChange: (checked: boolean) => void;
  onOptionChange: () => void;
  onCouponChange: () => void;
  onRemove: () => void;
}) {
  const product = item.product;
  const option = selectedOption(product, item.input.selected_option_id);
  const productOptions = product?.options ?? [];
  const hasOptions = productOptions.length > 0;
  const unitPrice = product
    ? productUnitPrice(product, option)
    : reformCost(item);
  const linePrice = unitPrice * item.input.quantity;
  const discount = couponDiscount(item.appliedCoupon?.coupon, linePrice);
  const discountedPrice = Math.max(0, linePrice - discount);
  const appliedCouponName = item.appliedCoupon
    ? couponLabel(item.appliedCoupon.coupon)
    : null;

  return (
    <Box
      bg="bg.layer-default"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      p={{ base: "x4", md: "x5" }}
    >
      <Grid templateColumns="auto minmax(0, 1fr)" gap="x4" alignItems="start">
        <Box alignSelf="start">
          <Checkbox
            checked={checked}
            aria-label="항목 선택"
            onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          />
        </Box>
        <VStack gap="x4" alignItems="stretch">
          <Grid templateColumns="6rem minmax(0, 1fr)" gap="x4">
            {product ? (
              <ImageFrame
                ratio={1}
                src={product.image}
                alt={product.name}
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

            <VStack gap="x2" alignItems="stretch">
              <HStack justify="space-between" gap="x3" align="flex-start">
                <VStack gap="x1" minWidth={0}>
                  <HStack gap="x2" wrap>
                    <Badge variant="outline">
                      {item.input.item_type === "reform" ? "수선" : "상품"}
                    </Badge>
                    {item.unavailable ? (
                      <Badge variant="solid" tone="critical">
                        확인 필요
                      </Badge>
                    ) : null}
                  </HStack>
                  <Text textStyle="label" maxLines={2}>
                    {product?.name ?? reformTitle(item)}
                  </Text>
                  <Text textStyle="caption" color="fg.neutral-muted">
                    {option?.name ?? (hasOptions ? "옵션 확인 필요" : "FREE")} /{" "}
                    {item.input.quantity}개
                  </Text>
                  <ItemPriceDisplay
                    basePrice={linePrice}
                    discountedPrice={discountedPrice}
                    couponName={appliedCouponName}
                  />
                </VStack>
                <ActionButton
                  type="button"
                  variant="ghost"
                  size="small"
                  iconOnly
                  aria-label="삭제"
                  onClick={onRemove}
                >
                  <Icon svg={<TrashIcon />} size={18} />
                </ActionButton>
              </HStack>
            </VStack>
          </Grid>
          <HStack gap="x2" wrap="nowrap">
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              size="small"
              width="full"
              disabled={busy || item.unavailable}
              onClick={onOptionChange}
            >
              옵션 변경
            </Box>
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              size="small"
              width="full"
              onClick={onCouponChange}
            >
              {isAuthed ? "쿠폰 사용" : "로그인 후 쿠폰"}
            </Box>
          </HStack>
        </VStack>
      </Grid>
    </Box>
  );
}

function ItemPriceDisplay({
  basePrice,
  discountedPrice,
  couponName,
}: {
  basePrice: number;
  discountedPrice: number;
  couponName: string | null;
}) {
  if (!couponName) {
    return <Text textStyle="label">₩{krw.format(basePrice)}</Text>;
  }

  return (
    <VStack gap="x0_5" alignItems="flex-start">
      <HStack gap="x2" wrap>
        <Text
          textStyle="caption"
          color="fg.neutral-muted"
          style={{ textDecoration: "line-through" }}
        >
          ₩{krw.format(basePrice)}
        </Text>
        <Text textStyle="label" color="fg.critical">
          ₩{krw.format(discountedPrice)}
        </Text>
      </HStack>
      <Text textStyle="captionSm" color="fg.neutral-muted">
        {couponName} 적용
      </Text>
    </VStack>
  );
}

function OptionModal({
  item,
  open,
  onOpenChange,
  onApply,
}: {
  item: CartViewItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (values: { optionId: string; quantity: number }) => Promise<void>;
}) {
  const product = item?.product ?? null;
  const options = product?.options ?? [];
  const selected = selectedOption(product, item?.input.selected_option_id);
  const [optionId, setOptionId] = useState("");
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    setOptionId(item?.input.selected_option_id ?? "");
    setQuantity(item?.input.quantity ?? 1);
  }, [item]);

  const stock =
    selectedOption(product, optionId)?.stock ?? product?.stock ?? null;

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="옵션 변경"
      size="medium"
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            disabled={!product || (options.length > 0 && optionId === "")}
            onClick={() => void onApply({ optionId, quantity })}
          >
            변경
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        <VStack gap="x1">
          <Text textStyle="label">{product?.name ?? "상품 정보 확인 중"}</Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            현재 옵션: {selected?.name ?? "FREE"}
          </Text>
        </VStack>

        {options.length > 0 ? (
          <SelectBox
            value={optionId}
            onValueChange={(value) => setOptionId(String(value))}
            aria-label="상품 옵션"
          >
            {options.map((candidate) => (
              <SelectBoxItem
                key={candidate.id}
                value={candidate.id}
                label={candidateLabel(candidate)}
                description={candidateDescription(candidate)}
                disabled={candidate.stock === 0}
              />
            ))}
          </SelectBox>
        ) : null}

        <HStack justify="space-between" gap="x4">
          <Text textStyle="labelSm" color="fg.neutral-muted">
            수량
          </Text>
          <QuantityStepper
            quantity={quantity}
            max={stock ?? undefined}
            onChange={setQuantity}
          />
        </HStack>
      </VStack>
    </ResponsiveModal>
  );
}

function QuantityStepper({
  quantity,
  max,
  disabled,
  onChange,
}: {
  quantity: number;
  max?: number;
  disabled?: boolean;
  onChange: (quantity: number) => void;
}) {
  return (
    <HStack gap="x2">
      <ActionButton
        type="button"
        variant="neutralOutline"
        size="xsmall"
        iconOnly
        aria-label="수량 줄이기"
        disabled={disabled || quantity <= 1}
        onClick={() => onChange(Math.max(1, quantity - 1))}
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
        disabled={disabled || (max !== undefined && quantity >= max)}
        onClick={() =>
          onChange(max ? Math.min(max, quantity + 1) : quantity + 1)
        }
      >
        <Icon svg={<PlusIcon />} size={16} />
      </ActionButton>
    </HStack>
  );
}

function CartSummary({
  totals,
  selectedCount,
}: {
  totals: CartTotals;
  selectedCount: number;
}) {
  return (
    <VStack gap="x4" alignItems="stretch">
      <VStack gap="x1">
        <Text as="h2" textStyle="title3">
          주문 금액
        </Text>
        <Text textStyle="caption" color="fg.neutral-muted">
          선택한 항목 기준 예상 결제 금액입니다.
        </Text>
      </VStack>
      <Divider />
      <SummaryRow label="선택 항목" value={`${selectedCount}개`} />
      <SummaryRow label="상품 금액" value={`₩${krw.format(totals.subtotal)}`} />
      <SummaryRow
        label="쿠폰 할인"
        value={`-₩${krw.format(totals.discount)}`}
        tone={totals.discount > 0 ? "informative" : "neutral"}
      />
      <Divider />
      <SummaryRow
        label="결제 예정 금액"
        value={`₩${krw.format(totals.total)}`}
        strong
      />
    </VStack>
  );
}

function SummaryRow({
  label,
  value,
  strong,
  tone = "neutral",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "neutral" | "informative";
}) {
  const valueColor = tone === "informative" ? "fg.informative" : "fg.neutral";
  return (
    <HStack justify="space-between" gap="x4">
      <Text textStyle={strong ? "label" : "bodySm"} color="fg.neutral-muted">
        {label}
      </Text>
      <Text textStyle={strong ? "title3" : "labelSm"} color={valueColor}>
        {value}
      </Text>
    </HStack>
  );
}

function CartRecommendations({ onShop }: { onShop: () => void }) {
  return (
    <VStack gap="x3" alignItems="stretch">
      <Text as="h2" textStyle="title2">
        함께 둘러보기
      </Text>
      <Box bg="bg.neutral-weak" borderRadius="r3" p={{ base: "x4", md: "x5" }}>
        <HStack justify="space-between" gap="x4" wrap>
          <VStack gap="x1" minWidth={0}>
            <Text textStyle="label">
              스토어에서 더 많은 넥타이를 확인하세요
            </Text>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              장바구니에 담긴 상품과 어울리는 패턴을 추가로 찾아볼 수 있습니다.
            </Text>
          </VStack>
          <ActionButton type="button" variant="neutralOutline" onClick={onShop}>
            스토어 보기
          </ActionButton>
        </HStack>
      </Box>
    </VStack>
  );
}

function CartSkeleton() {
  return (
    <VStack gap="x3" alignItems="stretch">
      <Skeleton width="45%" height={24} />
      {Array.from({ length: 3 }, (_, index) => (
        <Box
          key={index}
          bg="bg.layer-default"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          p="x5"
        >
          <Grid templateColumns="6rem minmax(0, 1fr)" gap="x4">
            <AspectRatio ratio={1} className="rounded-r2">
              <Skeleton
                width="100%"
                height="100%"
                radius={0}
                className="absolute inset-0"
              />
            </AspectRatio>
            <VStack gap="x3" alignItems="stretch">
              <Skeleton width="70%" height={20} />
              <Skeleton width="45%" height={16} />
              <Skeleton width="100%" height={36} />
            </VStack>
          </Grid>
        </Box>
      ))}
    </VStack>
  );
}

type CartTotals = {
  subtotal: number;
  discount: number;
  total: number;
};

function calculateTotals(items: CartViewItem[]): CartTotals {
  return items.reduce<CartTotals>(
    (totals, item) => {
      const option = selectedOption(
        item.product,
        item.input.selected_option_id,
      );
      const unitPrice = item.product
        ? productUnitPrice(item.product, option)
        : reformCost(item);
      const linePrice = unitPrice * item.input.quantity;
      const discount = couponDiscount(item.appliedCoupon?.coupon, linePrice);
      return {
        subtotal: totals.subtotal + linePrice,
        discount: totals.discount + discount,
        total: totals.total + Math.max(0, linePrice - discount),
      };
    },
    { subtotal: 0, discount: 0, total: 0 },
  );
}

function reformCost(item: CartViewItem) {
  const cost = item.input.reform_data?.cost;
  return typeof cost === "number" ? cost : 0;
}

function reformTitle(item: CartViewItem) {
  if (item.input.item_type !== "reform") return "상품 정보 확인 중";
  return "수선 요청";
}

function candidateLabel(option: { name: string; additional_price: number }) {
  return option.additional_price > 0
    ? `${option.name} (+₩${krw.format(option.additional_price)})`
    : option.name;
}

function candidateDescription(option: { stock: number | null }) {
  if (option.stock === 0) return "품절";
  if (option.stock != null && option.stock <= 5)
    return `${option.stock}개 남음`;
  return undefined;
}

function cartCrumbs() {
  return [{ label: "홈", href: "/" }, { label: "장바구니" }];
}

function sameStringArray(left: string[], right: string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
