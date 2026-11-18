import type { ReactNode } from "react";
import { useState } from "react";

import { FieldButton } from "./field-button";
import { CheckGlyph } from "./internal/glyphs";
import { useControllableState } from "./internal/use-controllable-state";
import { List, ListItem } from "./list";
import { Modal } from "./modal";
import { TextField } from "./text-field";

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
  disabled?: boolean;
  /** 피커 제목 — 기본 label */
  title?: ReactNode;
  /** 목록 위에 검색창을 둔다 — 문자열 label만 걸러진다. */
  searchable?: boolean;
};

/* 목록에서 하나를 고르는 피커 — FieldButton + 반응형 Modal + List. */
export function ListPicker({
  options,
  value,
  defaultValue,
  onValueChange,
  label,
  description,
  errorMessage,
  placeholder = "선택",
  disabled,
  title,
  searchable = false,
}: ListPickerProps) {
  const [current, setCurrent] = useControllableState<string | undefined>({
    value,
    defaultValue,
    onChange: (next) => {
      if (next !== undefined) onValueChange?.(next);
    },
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const keyword = search.trim().toLowerCase();
  const visible = keyword
    ? options.filter(
        (option) =>
          typeof option.label !== "string" ||
          option.label.toLowerCase().includes(keyword),
      )
    : options;
  const selected = options.find((option) => option.value === current);
  const pickerTitle = title ?? label;

  return (
    <>
      <FieldButton
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
      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch("");
        }}
        title={pickerTitle}
        aria-label={pickerTitle == null ? "선택" : undefined}
      >
        {/* 컨테이너 거터(x4)만큼 블리드 — ListItem 자체 px-x4와 상쇄되어
            옵션 텍스트가 시트/모달 제목과 같은 x에 정렬된다 */}
        {searchable ? (
          <TextField
            type="search"
            aria-label="검색"
            placeholder="검색"
            value={search}
            onChange={(event) => setSearch(event.currentTarget.value)}
            // dialog는 포털 없이 제자리에 그려진다 — 폼 안에서 Enter가 바깥 폼을 제출하지 않게 막는다
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
        ) : null}
        <List className="-mx-x4">
          {visible.map((option) => (
            <ListItem
              key={option.value}
              title={option.label}
              description={option.description}
              disabled={option.disabled}
              onClick={() => {
                setCurrent(option.value);
                setOpen(false);
                setSearch("");
              }}
              suffix={
                option.value === current ? (
                  <CheckGlyph className="size-5 text-fg-brand" />
                ) : undefined
              }
            />
          ))}
        </List>
      </Modal>
    </>
  );
}
