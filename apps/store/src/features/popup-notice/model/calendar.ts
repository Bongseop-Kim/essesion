/**
 * 휴무·명절 안내 달력 — 날짜 4개(마감·휴무 시작·휴무 종료·재개)에서 주 단위 격자를 만든다.
 * 시안(docs/reviews/store-popup-notice-2026-09-09.md): 마감일은 검은 원, 휴무 기간은 회색 띠, 재개일은 테두리 원.
 * 날짜 문자열은 `YYYY-MM-DD`이며 시간대 영향을 받지 않게 UTC 자정으로만 계산한다.
 */

export type HolidayDates = {
  cutoff_on: string;
  closed_from: string;
  closed_to: string;
  resume_on: string;
};

export type CalendarDayKind = "cutoff" | "closed" | "resume" | "plain";

export type CalendarDay = {
  iso: string;
  day: number;
  kind: CalendarDayKind;
  /** 표시 기준 월(휴무 시작일의 월) 밖의 날 — 흐리게 그린다 */
  outsideMonth: boolean;
  /** 휴무 띠의 시작/끝 — 주 경계에서도 끊어 양끝을 둥글게 */
  bandStart: boolean;
  bandEnd: boolean;
};

export type HolidayCalendar = {
  /** 1–12 */
  month: number;
  weeks: CalendarDay[][];
};

const DAY_MS = 86_400_000;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;

function parse(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function weekdayLabel(iso: string): string {
  return WEEKDAYS[new Date(parse(iso)).getUTCDay()] as string;
}

/** "23일(수)" */
export function formatDayWithWeekday(iso: string): string {
  return `${new Date(parse(iso)).getUTCDate()}일(${weekdayLabel(iso)})`;
}

/** "14:00" → "오후 2시", "09:30" → "오전 9시 30분" */
export function formatKoreanTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const period = h < 12 ? "오전" : "오후";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${period} ${hour}시` : `${period} ${hour}시 ${m}분`;
}

export function buildHolidayCalendar(dates: HolidayDates): HolidayCalendar {
  const cutoff = parse(dates.cutoff_on);
  const closedFrom = parse(dates.closed_from);
  const closedTo = parse(dates.closed_to);
  const resume = parse(dates.resume_on);

  const first = Math.min(cutoff, closedFrom);
  const start = first - new Date(first).getUTCDay() * DAY_MS;
  const last = Math.max(resume, closedTo);
  const end = last + (6 - new Date(last).getUTCDay()) * DAY_MS;
  const weekCount = Math.round((end - start + DAY_MS) / (7 * DAY_MS));
  const month = new Date(closedFrom).getUTCMonth();

  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < weekCount; w += 1) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d += 1) {
      const ms = start + (w * 7 + d) * DAY_MS;
      const date = new Date(ms);
      const inBand = ms >= closedFrom && ms <= closedTo;
      const kind: CalendarDayKind =
        ms === cutoff
          ? "cutoff"
          : ms === resume
            ? "resume"
            : inBand
              ? "closed"
              : "plain";
      week.push({
        iso: toIso(ms),
        day: date.getUTCDate(),
        kind,
        outsideMonth: date.getUTCMonth() !== month,
        bandStart: inBand && (ms === closedFrom || d === 0),
        bandEnd: inBand && (ms === closedTo || d === 6),
      });
    }
    weeks.push(week);
  }
  return { month: month + 1, weeks };
}

export const WEEKDAY_LABELS = WEEKDAYS;
