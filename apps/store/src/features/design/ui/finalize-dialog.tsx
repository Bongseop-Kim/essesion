import {
  ActionButton,
  Box,
  HStack,
  Modal,
  SelectBox,
  SelectBoxItem,
  Text,
  VStack,
} from "@essesion/shared";
import { useState } from "react";

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

export type FinalizeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (value: FinalizeDialogValue) => void;
  /** 실사화 1회 토큰 단가 — null이면 미로드(표기 생략, 서버가 최종 방어) */
  cost: number | null;
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

/**
 * 짜임 스와치 — 워커가 실제 렌더에 쓰는 텍스처에서 뽑은 장식 이미지
 * (`apps/worker/scripts/export_weave_swatches.py`, 파일명 = weave 값).
 * 흰 원단이라 그대로 축소하면 결이 사라진다 — 스와치 자체가 확대 크롭이고,
 * 표시 배율(2배)로 한 번 더 키워 결이 읽히게 한다.
 */
const SWATCH_PX = 72;

function WeaveSwatch({ weave }: { weave: FabricWeave }) {
  return (
    <Box
      aria-hidden
      width={SWATCH_PX}
      height={SWATCH_PX}
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r2"
      style={{
        backgroundImage: `url(/images/weaves/${weave}.png)`,
        backgroundSize: `${SWATCH_PX * 2}px ${SWATCH_PX * 2}px`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      }}
    />
  );
}

const PRINT_WEAVES: readonly FabricWeave[] = ["twill-0", "twill-45"];

/** 제작 방식·짜임은 다이얼로그 로컬 폼 상태다 — 캔버스가 들고 있을 값이 아니다. */
export function FinalizeDialog({
  open,
  onOpenChange,
  onSubmit,
  cost,
  loading = false,
  disabled = false,
}: FinalizeDialogProps) {
  const [productionMethod, setProductionMethod] =
    useState<ProductionMethod>("print");
  const [weave, onWeaveChange] = useState<FabricWeave>("twill-45");
  // 날염은 트윌 2종만 지원 — 방식이 바뀌면 선택을 유효한 값으로 되돌린다.
  const onProductionMethodChange = (method: ProductionMethod) => {
    setProductionMethod(method);
    if (method === "print" && !PRINT_WEAVES.includes(weave)) {
      onWeaveChange("twill-45");
    }
  };
  const availableWeaves =
    productionMethod === "print"
      ? WEAVES.filter((option) => PRINT_WEAVES.includes(option.value))
      : WEAVES;
  const validWeave = availableWeaves.some((option) => option.value === weave);
  const submitDisabled = disabled || !validWeave;
  const costLabel = cost == null ? "" : ` · ${cost}토큰`;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="실사화"
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
            실사화 만들기{costLabel}
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
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
                disabled={disabled || loading}
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
                media={<WeaveSwatch weave={option.value} />}
                disabled={disabled || loading}
              />
            ))}
          </SelectBox>
          {!validWeave ? (
            <Text textStyle="caption" color="fg.critical">
              선택한 제작 방식에 맞는 짜임을 골라 주세요.
            </Text>
          ) : null}
        </VStack>

        <Text textStyle="caption" color="fg.neutral-muted">
          실제 제작물은 장인이 직조 방식을 최종 결정하며 이미지와 다를 수
          있어요.
        </Text>
      </VStack>
    </Modal>
  );
}
