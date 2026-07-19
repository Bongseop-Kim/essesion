import {
  ActionButton,
  Box,
  HStack,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Text,
  VStack,
} from "@essesion/shared";
import { useEffect, useState } from "react";

import {
  AUTO_PATTERN_CONSTRAINTS,
  type DesignPatternConstraints,
  type MotifScale,
  type PatternArrangement,
  type PatternDensity,
  type PatternDirection,
} from "@/features/design/model/draft";

const SCALE_OPTIONS: ReadonlyArray<{ value: MotifScale; label: string }> = [
  { value: "auto", label: "자동" },
  { value: "small", label: "작게" },
  { value: "medium", label: "보통" },
  { value: "large", label: "크게" },
];
const DENSITY_OPTIONS: ReadonlyArray<{
  value: PatternDensity;
  label: string;
}> = [
  { value: "auto", label: "자동" },
  { value: "sparse", label: "여유롭게" },
  { value: "medium", label: "보통" },
  { value: "dense", label: "촘촘하게" },
];
const ARRANGEMENT_OPTIONS: ReadonlyArray<{
  value: PatternArrangement;
  label: string;
  description?: string;
}> = [
  { value: "auto", label: "자동" },
  { value: "lattice", label: "격자" },
  {
    value: "staggered",
    label: "엇갈림",
    description: "격자 행을 반 칸씩 어긋나게 배치",
  },
  { value: "scatter", label: "흩뿌림" },
];
const DIRECTION_OPTIONS: ReadonlyArray<{
  value: PatternDirection;
  label: string;
}> = [
  { value: "auto", label: "자동" },
  { value: "vertical", label: "수직" },
  { value: "horizontal", label: "수평" },
  { value: "diagonal", label: "대각선" },
];

export type PatternSettingsModalProps = {
  open: boolean;
  value: DesignPatternConstraints;
  onOpenChange: (open: boolean) => void;
  onApply: (value: DesignPatternConstraints) => void;
};

export function PatternSettingsModal({
  open,
  value,
  onOpenChange,
  onApply,
}: PatternSettingsModalProps) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);

  const set = <Key extends keyof DesignPatternConstraints>(
    key: Key,
    next: DesignPatternConstraints[Key],
  ) => setDraft((current) => ({ ...current, [key]: next }));

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="패턴 설정"
      description="엔진이 안정적으로 지원하는 크기, 밀도, 배열, 방향을 지정하세요."
      size="medium"
      showCloseButton
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
            onClick={() => {
              onApply(draft);
              onOpenChange(false);
            }}
          >
            적용
          </Box>
        </HStack>
      }
    >
      <VStack gap="x5" alignItems="stretch">
        <PatternOptionGroup
          label="모티프 크기"
          value={draft.motifScale}
          options={SCALE_OPTIONS}
          onChange={(next) => set("motifScale", next as MotifScale)}
        />
        <PatternOptionGroup
          label="밀도"
          value={draft.density}
          options={DENSITY_OPTIONS}
          onChange={(next) => set("density", next as PatternDensity)}
        />
        <PatternOptionGroup
          label="배열"
          value={draft.arrangement}
          options={ARRANGEMENT_OPTIONS}
          onChange={(next) => set("arrangement", next as PatternArrangement)}
        />
        <PatternOptionGroup
          label="방향"
          value={draft.direction}
          options={DIRECTION_OPTIONS}
          onChange={(next) => set("direction", next as PatternDirection)}
        />
        <ActionButton
          type="button"
          variant="ghost"
          onClick={() => setDraft(AUTO_PATTERN_CONSTRAINTS)}
        >
          모든 설정 자동으로 초기화
        </ActionButton>
      </VStack>
    </ResponsiveModal>
  );
}

function PatternOptionGroup({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ReadonlyArray<{
    value: string;
    label: string;
    description?: string;
  }>;
  onChange: (value: string) => void;
}) {
  return (
    <VStack gap="x2" alignItems="stretch">
      <Text textStyle="label">{label}</Text>
      <SelectBox
        value={value}
        onValueChange={(next) => onChange(next as string)}
        columns={{ base: 2, sm: 4 }}
        aria-label={label}
      >
        {options.map((option) => (
          <SelectBoxItem
            key={option.value}
            value={option.value}
            label={option.label}
            description={option.description}
          />
        ))}
      </SelectBox>
    </VStack>
  );
}
