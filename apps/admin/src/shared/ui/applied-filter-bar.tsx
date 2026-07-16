import { ActionButton, Chip, HStack, Text } from "@essesion/shared";

export type AppliedFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

type AppliedFilterBarProps = {
  filters: readonly (AppliedFilter | false | null | undefined)[];
  onReset: () => void;
};

export function AppliedFilterBar({ filters, onReset }: AppliedFilterBarProps) {
  const activeFilters = filters.filter((filter): filter is AppliedFilter =>
    Boolean(filter),
  );
  if (activeFilters.length === 0) return null;

  return (
    <HStack role="group" aria-label="적용된 필터" gap="x2" align="center" wrap>
      <Text textStyle="labelSm">필터 {activeFilters.length}</Text>
      {activeFilters.map((filter) => (
        <Chip
          key={filter.key}
          selected
          size="small"
          aria-label={`${filter.label} 필터 제거`}
          onClick={filter.onRemove}
        >
          {filter.label} ×
        </Chip>
      ))}
      <ActionButton variant="ghost" size="small" onClick={onReset}>
        전체 초기화
      </ActionButton>
    </HStack>
  );
}
