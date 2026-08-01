import {
  Flex,
  HStack,
  Icon,
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
  Text,
  VStack,
} from "@essesion/shared";
import { CreditCardIcon } from "@heroicons/react/24/outline";

import { krw } from "@/shared/lib/format";

export type TokenPillProps = {
  balance: number | null;
  generateCost: number | null;
  editCost: number | null;
  onPurchase: () => void;
};

/** 캔버스 우상단 잔액 pill — 클릭하면 잔액 상세와 충전 경로가 열린다. */
export function TokenPill({
  balance,
  generateCost,
  editCost,
  onPurchase,
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
          className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
        >
          <Icon
            svg={<CreditCardIcon />}
            size={18}
            color="fg.neutral-muted"
            aria-label="토큰 잔액"
          />
          <Text textStyle="labelSm">{format(balance)}토큰</Text>
        </HStack>
      </MenuTrigger>
      <MenuContent aria-label="토큰 잔액 상세">
        <VStack gap="x0_5" alignItems="stretch" px="x2" py="x1_5">
          <Text textStyle="labelSm">잔액 {format(balance)}토큰</Text>
          <Text textStyle="captionSm" color="fg.neutral-subtle">
            처음 만들기 1회 {format(generateCost)}토큰 · 고치기 1회{" "}
            {format(editCost)}토큰
          </Text>
        </VStack>
        <MenuItem
          label="토큰 충전하기"
          prefixIcon={<Icon svg={<CreditCardIcon />} size={18} />}
          onClick={onPurchase}
        />
      </MenuContent>
    </MenuRoot>
  );
}

/** 잔액 pill을 열 수 없는 비로그인 상태 — 같은 자리에 안내만 남긴다. */
export function TokenPillPlaceholder() {
  return (
    <Flex
      px="x3_5"
      py="x2"
      bg="bg.layer-floating"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="full"
      boxShadow="s1"
    >
      <Text textStyle="labelSm" color="fg.neutral-subtle">
        로그인 후 이용
      </Text>
    </Flex>
  );
}

function format(value: number | null) {
  return value == null ? "—" : krw.format(value);
}
