import {
  ActionButton,
  Box,
  Callout,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Text,
  VStack,
} from "@essesion/shared";

export type ProductionMethod = "print" | "yarn_dyed";

export type FabricWeave =
  | "check"
  | "herringbone"
  | "jacquard"
  | "pindot"
  | "solid"
  | "twill-0"
  | "twill-45";

export type FinalizeDialogValue = {
  productionMethod: ProductionMethod;
  weave: FabricWeave;
  dpi: 300;
};

export type FinalizeDialogProps = FinalizeDialogValue & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProductionMethodChange: (method: ProductionMethod) => void;
  onWeaveChange: (weave: FabricWeave) => void;
  onSubmit: (value: FinalizeDialogValue) => void;
  /** 계정당 24시간 쿼터 남은 횟수 — null이면 미로드/설정 부재(막지 않음, 서버가 최종 방어) */
  remaining: number | null;
  /** 쿼터 소진 시 슬롯이 하나 풀리는 시각(ISO) — 카운트 0이면 null */
  resetAt: string | null;
  loading?: boolean;
  disabled?: boolean;
};

const PRODUCTION_METHODS = [
  {
    value: "print",
    label: "날염",
    description: "완성된 원단 위에 디자인을 선명하게 인쇄해요.",
  },
  {
    value: "yarn_dyed",
    label: "선염",
    description: "염색한 실로 직조해 무늬와 질감을 함께 표현해요.",
  },
] as const satisfies readonly {
  value: ProductionMethod;
  label: string;
  description: string;
}[];

const WEAVES = [
  { value: "check", label: "체크", description: "격자 짜임" },
  {
    value: "herringbone",
    label: "헤링본",
    description: "V자 형태가 이어지는 짜임",
  },
  {
    value: "jacquard",
    label: "자카드",
    description: "무늬가 도드라지는 입체 짜임",
  },
  { value: "pindot", label: "핀도트", description: "잔점 질감의 짜임" },
  { value: "solid", label: "솔리드", description: "균일하고 차분한 짜임" },
  { value: "twill-0", label: "직선 트윌", description: "반듯한 결의 능직" },
  {
    value: "twill-45",
    label: "사선 트윌",
    description: "대각선 결이 선명한 능직",
  },
] as const satisfies readonly {
  value: FabricWeave;
  label: string;
  description: string;
}[];

const PRINT_WEAVES: readonly FabricWeave[] = ["twill-0", "twill-45"];

const RESET_AT_FORMAT = new Intl.DateTimeFormat("ko-KR", {
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatResetAt(resetAt: string | null): string | null {
  if (!resetAt) return null;
  const parsed = new Date(resetAt);
  return Number.isNaN(parsed.getTime()) ? null : RESET_AT_FORMAT.format(parsed);
}

export function FinalizeDialog({
  open,
  onOpenChange,
  productionMethod,
  weave,
  onProductionMethodChange,
  onWeaveChange,
  onSubmit,
  remaining,
  resetAt,
  loading = false,
  disabled = false,
}: FinalizeDialogProps) {
  const availableWeaves =
    productionMethod === "print"
      ? WEAVES.filter((option) => PRINT_WEAVES.includes(option.value))
      : WEAVES;
  const validWeave = availableWeaves.some((option) => option.value === weave);
  const exhausted = remaining !== null && remaining <= 0;
  const submitDisabled = disabled || exhausted || !validWeave;
  const resetAtLabel = formatResetAt(resetAt);

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="실사화"
      description={
        remaining === null
          ? undefined
          : `최근 24시간 남은 횟수 ${Math.max(0, remaining)}회`
      }
      size="medium"
      showCloseButton
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={loading}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            loading={loading}
            disabled={submitDisabled}
            onClick={() => onSubmit({ productionMethod, weave, dpi: 300 })}
          >
            실사화 만들기
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        {exhausted ? (
          <Callout
            tone="warning"
            title="실사화 횟수를 모두 사용했어요"
            description={
              resetAtLabel
                ? `최근 24시간 한도에 도달했어요. ${resetAtLabel} 이후 다시 만들 수 있어요.`
                : "최근 24시간 한도에 도달했어요. 잠시 후 다시 시도해 주세요."
            }
          />
        ) : null}

        <VStack gap="x2" alignItems="stretch">
          <Text textStyle="label">제작 방식</Text>
          <SelectBox
            value={productionMethod}
            onValueChange={(value) =>
              onProductionMethodChange(value as ProductionMethod)
            }
            columns={{ base: 1, sm: 2 }}
            aria-label="제작 방식"
          >
            {PRODUCTION_METHODS.map((method) => (
              <SelectBoxItem
                key={method.value}
                value={method.value}
                label={method.label}
                description={method.description}
                disabled={disabled || loading || exhausted}
              />
            ))}
          </SelectBox>
        </VStack>

        <VStack gap="x2" alignItems="stretch">
          <Text textStyle="label">원단 짜임</Text>
          <SelectBox
            value={validWeave ? weave : ""}
            onValueChange={(value) => onWeaveChange(value as FabricWeave)}
            columns={{ base: 1, sm: 2 }}
            aria-label="원단 짜임"
          >
            {availableWeaves.map((option) => (
              <SelectBoxItem
                key={option.value}
                value={option.value}
                label={option.label}
                description={option.description}
                disabled={disabled || loading || exhausted}
              />
            ))}
          </SelectBox>
          {!validWeave ? (
            <Text textStyle="caption" color="fg.critical">
              선택한 제작 방식에 맞는 짜임을 골라 주세요.
            </Text>
          ) : null}
        </VStack>

        <Callout
          tone="neutral"
          title="출력 품질"
          description="실사화 이미지는 300 DPI로 생성돼요."
        />
      </VStack>
    </ResponsiveModal>
  );
}
