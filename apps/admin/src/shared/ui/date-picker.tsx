import {
  ActionButton,
  Box,
  cn,
  Field,
  FieldButton,
  Grid,
  HStack,
  Icon,
  ResponsiveModal,
  Text,
} from "@essesion/shared";
import {
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { useState } from "react";

const pad = (n: number) => String(n).padStart(2, "0");
const toIso = (year: number, month: number, day: number) =>
  `${year}-${pad(month)}-${pad(day)}`;

/** month는 1–12. 요일 오프셋·후행 패딩은 null, 그 사이 해당 월의 "YYYY-MM-DD" 문자열.
    항상 42칸(6주) — 월이 바뀌어도 피커 높이가 출렁이지 않는다. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const offset = new Date(year, month - 1, 1).getDay();
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: 42 }, (_, i) => {
    const day = i - offset + 1;
    return day >= 1 && day <= days ? toIso(year, month, day) : null;
  });
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const formatter = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" });
const formatDate = (iso: string) => formatter.format(new Date(`${iso}T00:00`));

export type DatePickerProps = {
  label?: ReactNode;
  /** "YYYY-MM-DD" — 빈 문자열/undefined는 미선택 */
  value?: string;
  /** 선택 시 "YYYY-MM-DD", 지우기 시 "" */
  onValueChange?: (value: string) => void;
  /** "YYYY-MM-DD" — 범위 밖 날짜는 비활성 */
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  errorMessage?: ReactNode;
};

/* 날짜 피커 — FieldButton(트리거) + ResponsiveModal(모바일 시트↔PC 모달) + 월 달력.
   값 계약은 <input type="date">와 동일한 "YYYY-MM-DD"라 min/max도 문자열 비교로 충분. */
export function DatePicker({
  label,
  value,
  onValueChange,
  min,
  max,
  required,
  disabled,
  errorMessage,
}: DatePickerProps) {
  const [open, setOpen] = useState(false);
  // 닫혀 있어도 Modal이 children을 마운트하므로 유효한 달로 초기화해야 한다
  const [view, setView] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  });

  const now = new Date();
  const todayIso = toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const selectable = (iso: string) =>
    (min == null || iso >= min) && (max == null || iso <= max);

  const openPicker = () => {
    const base = value ? new Date(`${value}T00:00`) : now;
    setView({ year: base.getFullYear(), month: base.getMonth() + 1 });
    setOpen(true);
  };
  const moveMonth = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month - 1 + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() + 1 };
    });
  const pick = (iso: string) => {
    onValueChange?.(iso);
    setOpen(false);
  };

  const nav = (icon: ReactNode, ariaLabel: string, delta: number) => (
    <ActionButton
      variant="ghost"
      size="xsmall"
      iconOnly
      aria-label={ariaLabel}
      onClick={() => moveMonth(delta)}
    >
      {icon}
    </ActionButton>
  );

  return (
    <>
      <Box minWidth={150}>
        <Field
          label={label}
          required={required}
          disabled={disabled}
          errorMessage={errorMessage}
        >
          <FieldButton
            placeholder="날짜 선택"
            value={value ? formatDate(value) : undefined}
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={openPicker}
          />
        </Field>
      </Box>
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title={label ?? "날짜 선택"}
        size="small"
        footer={
          <HStack justify="space-between">
            <ActionButton
              variant="ghost"
              size="small"
              disabled={!selectable(todayIso)}
              onClick={() => pick(todayIso)}
            >
              오늘
            </ActionButton>
            <ActionButton variant="ghost" size="small" onClick={() => pick("")}>
              지우기
            </ActionButton>
          </HStack>
        }
      >
        <HStack justify="space-between" gap="x1">
          <HStack gap="x1">
            {nav(
              <Icon svg={<ChevronDoubleLeftIcon />} size={16} />,
              "이전 해",
              -12,
            )}
            {nav(<Icon svg={<ChevronLeftIcon />} size={16} />, "이전 달", -1)}
          </HStack>
          <Text textStyle="label" aria-live="polite">
            {view.year}년 {view.month}월
          </Text>
          <HStack gap="x1">
            {nav(<Icon svg={<ChevronRightIcon />} size={16} />, "다음 달", 1)}
            {nav(
              <Icon svg={<ChevronDoubleRightIcon />} size={16} />,
              "다음 해",
              12,
            )}
          </HStack>
        </HStack>
        <Grid columns={7} gap="x1" pt="x3">
          {WEEKDAYS.map((day) => (
            <Text
              key={day}
              as="span"
              textStyle="captionSm"
              color="fg.neutral-subtle"
              align="center"
            >
              {day}
            </Text>
          ))}
          {monthGrid(view.year, view.month).map((iso, index) =>
            iso == null ? (
              <span key={`blank-${index}`} className="h-9" />
            ) : (
              <button
                key={iso}
                type="button"
                disabled={!selectable(iso)}
                aria-label={formatDate(iso)}
                aria-current={iso === todayIso ? "date" : undefined}
                aria-pressed={iso === value}
                onClick={() => pick(iso)}
                className={cn(
                  "flex h-9 items-center justify-center rounded-r2 text-t4 transition-colors duration-100 ease-standard focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-stroke-focus-ring",
                  iso === value
                    ? "bg-bg-brand-solid text-fg-contrast hover:bg-bg-brand-solid-hover"
                    : cn(
                        "hover:bg-bg-neutral-weak active:bg-bg-neutral-weak-pressed",
                        iso === todayIso ? "text-fg-brand" : "text-fg-neutral",
                      ),
                  !selectable(iso) && "text-fg-disabled hover:bg-transparent",
                )}
              >
                {Number(iso.slice(8))}
              </button>
            ),
          )}
        </Grid>
      </ResponsiveModal>
    </>
  );
}
