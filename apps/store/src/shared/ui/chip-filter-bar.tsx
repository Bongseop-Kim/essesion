import { Chip, HStack, ScrollFog } from "@essesion/shared";

/** 가로 스크롤 칩 필터 행 — 목록 화면의 유형/상태 필터. */
export function ChipFilterBar<T extends string>({
  filters,
  value,
  onChange,
}: {
  filters: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <ScrollFog direction="horizontal">
      <HStack gap="x2">
        {filters.map((option) => (
          <Chip
            key={option.value}
            selected={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Chip>
        ))}
      </HStack>
    </ScrollFog>
  );
}
