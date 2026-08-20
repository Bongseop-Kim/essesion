import {
  HStack,
  Icon,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowPathIcon,
  CreditCardIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";

import { krw } from "@/shared/lib/format";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export type TokenPillProps = {
  balance: number | null;
  generateCost: number | null;
  editCost: number | null;
  motifGenerateCost: number | null;
  onPurchase: () => void;
  /**
   * 잔액 조회 실패. 실패를 0토큰으로 그리면 잔액이 없다고 오인해 불필요한 결제로 이어진다
   * — 돈 경로이므로 조용히 숨기지 않고 실패임을 드러내고 재시도를 준다.
   */
  failed?: boolean;
  onRetry?: () => void;
};

/** 캔버스 우상단 잔액 pill — 클릭하면 잔액 상세와 충전 경로가 열린다. */
export function TokenPill({
  balance,
  generateCost,
  editCost,
  motifGenerateCost,
  onPurchase,
  failed = false,
  onRetry,
}: TokenPillProps) {
  return (
    <MenuRoot placement="bottom">
      <MenuTrigger>
        <HStack
          as="button"
          type="button"
          gap="x1_5"
          px="x3_5"
          py="x2"
          bg="bg.layer-floating"
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="full"
          boxShadow="s1"
          className="whitespace-nowrap focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
        >
          <Icon
            svg={failed ? <ExclamationTriangleIcon /> : <CreditCardIcon />}
            size={18}
            color={failed ? "fg.critical" : "fg.neutral-muted"}
            aria-label="토큰 잔액"
          />
          <Text
            textStyle="labelSm"
            color={failed ? "fg.critical" : "fg.neutral"}
          >
            {failed
              ? "잔액 확인 불가"
              : balance === null
                ? "잔액 확인 중"
                : `${formatBalance(balance)}토큰`}
          </Text>
        </HStack>
      </MenuTrigger>
      <MenuContent aria-label="토큰 잔액 상세">
        <VStack gap="x0_5" alignItems="stretch" px="x2" py="x1_5">
          <Text textStyle="labelSm">
            {failed
              ? "잔액을 불러오지 못했어요"
              : balance === null
                ? "잔액을 확인하고 있어요"
                : `잔액 ${formatBalance(balance)}토큰`}
          </Text>
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            {failed
              ? "지금은 잔액을 확인할 수 없어요. 잠시 뒤 다시 시도해 주세요."
              : `처음 만들기 1회 ${format(generateCost)}토큰 · 고치기 1회 ${format(editCost)}토큰 · 새 무늬 1회 ${format(motifGenerateCost)}토큰`}
          </Text>
        </VStack>
        {failed && onRetry ? (
          <MenuItem
            label="다시 불러오기"
            prefixIcon={<Icon svg={<ArrowPathIcon />} size={18} />}
            onClick={onRetry}
          />
        ) : null}
        <MenuItem
          label="토큰 충전하기"
          prefixIcon={<Icon svg={<CreditCardIcon />} size={18} />}
          onClick={onPurchase}
        />
      </MenuContent>
    </MenuRoot>
  );
}

function format(value: number | null) {
  return value == null ? "—" : krw.format(value);
}

function formatBalance(balance: number) {
  return balance < 1_000
    ? krw.format(balance)
    : compact.format(balance).toLowerCase();
}
