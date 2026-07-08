import type { ReactNode } from "react";
import { useState } from "react";

import { FieldButton } from "./field-button";
import { CheckGlyph } from "./internal/glyphs";
import { useControllableState } from "./internal/use-controllable-state";
import { List, ListItem } from "./list";
import { ResponsiveModal } from "./responsive-modal";

export type ListPickerOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type ListPickerProps = {
  options: readonly ListPickerOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Field 래퍼 — FieldButton과 동일 규칙 */
  label?: ReactNode;
  description?: ReactNode;
  errorMessage?: ReactNode;
  placeholder?: ReactNode;
  size?: "medium" | "large";
  disabled?: boolean;
  /** 피커 제목 — 기본 label */
  title?: ReactNode;
};

/* 목록에서 하나를 고르는 피커 — FieldButton(트리거) + ResponsiveModal(모바일 시트↔PC 모달)
   + List(옵션). 선택 즉시 닫힌다. 옵션이 2~3개뿐이면 SelectBox/RadioGroup을 먼저 검토(overlay.md). */
export function ListPicker({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  description,
  errorMessage,
  placeholder = "선택",
  size = "medium",
  disabled,
  title,
}: ListPickerProps) {
  const [current, setCurrent] = useControllableState<string | undefined>({
    value,
    defaultValue,
    onChange: (next) => {
      if (next !== undefined) onValueChange?.(next);
    },
  });
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === current);
  const pickerTitle = title ?? label;

  return (
    <>
      <FieldButton
        size={size}
        label={label}
        description={description}
        errorMessage={errorMessage}
        placeholder={placeholder}
        value={selected?.label}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      />
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title={pickerTitle}
        aria-label={pickerTitle == null ? "선택" : undefined}
      >
        {/* 컨테이너 거터(x4)만큼 블리드 — ListItem 자체 px-x4와 상쇄되어
            옵션 텍스트가 시트/모달 제목과 같은 x에 정렬된다 */}
        <List className="-mx-x4">
          {options.map((option) => (
            <ListItem
              key={option.value}
              title={option.label}
              description={option.description}
              disabled={option.disabled}
              onClick={() => {
                setCurrent(option.value);
                setOpen(false);
              }}
              suffix={
                option.value === current ? (
                  <CheckGlyph className="size-5 text-fg-brand" />
                ) : undefined
              }
            />
          ))}
        </List>
      </ResponsiveModal>
    </>
  );
}
