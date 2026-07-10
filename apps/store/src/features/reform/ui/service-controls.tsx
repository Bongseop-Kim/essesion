import { Checkbox, HStack } from "@essesion/shared";

export function AutomaticAddonSelector({
  dimple,
  turnKnot,
  showTurnKnot,
  onDimpleChange,
  onTurnKnotChange,
}: {
  dimple: boolean;
  turnKnot: boolean;
  showTurnKnot: boolean;
  onDimpleChange: (selected: boolean) => void;
  onTurnKnotChange: (selected: boolean) => void;
}) {
  return (
    <HStack role="group" aria-label="추가 옵션" gap="x4" wrap>
      <Checkbox
        label="딤플"
        checked={dimple}
        onChange={(event) => onDimpleChange(event.currentTarget.checked)}
      />
      {showTurnKnot ? (
        <Checkbox
          label="돌려묶기"
          checked={turnKnot}
          onChange={(event) => onTurnKnotChange(event.currentTarget.checked)}
        />
      ) : null}
    </HStack>
  );
}
