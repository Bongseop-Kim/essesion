import { Checkbox, HStack, Text, VStack } from "@essesion/shared";

/** 추가 옵션 — 끈은 딤플 불가, 딤플은 돌려묶기와 함께만(체크 시 돌려묶기 잠금). */
export function AutomaticAddonSelector({
  mechanism,
  dimple,
  turnKnot,
  onDimpleChange,
  onTurnKnotChange,
}: {
  mechanism: "" | "zipper" | "string";
  dimple: boolean;
  turnKnot: boolean;
  onDimpleChange: (selected: boolean) => void;
  onTurnKnotChange: (selected: boolean) => void;
}) {
  return (
    <VStack gap="x1" alignItems="flex-start">
      <HStack role="group" aria-label="추가 옵션" gap="x4" wrap>
        {mechanism === "zipper" ? (
          <Checkbox
            label="딤플"
            checked={dimple}
            onChange={(event) => onDimpleChange(event.currentTarget.checked)}
          />
        ) : null}
        <Checkbox
          label="돌려묶기"
          checked={turnKnot}
          disabled={dimple}
          onChange={(event) => onTurnKnotChange(event.currentTarget.checked)}
        />
      </HStack>
      {dimple ? (
        <Text textStyle="caption" color="fg.neutral-muted">
          딤플을 선택하면 돌려묶기로 고정됩니다.
        </Text>
      ) : null}
    </VStack>
  );
}
