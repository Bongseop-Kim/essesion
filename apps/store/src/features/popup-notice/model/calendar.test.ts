import { describe, expect, it } from "vitest";

import {
  buildHolidayCalendar,
  formatDayWithWeekday,
  formatKoreanTime,
} from "./calendar";

// 2026 추석: 마감 9/23(수) → 휴무 9/24(목)–9/27(일) → 재개 9/28(월). 시안과 같은 입력.
const chuseok = {
  cutoff_on: "2026-09-23",
  closed_from: "2026-09-24",
  closed_to: "2026-09-27",
  resume_on: "2026-09-28",
};

describe("buildHolidayCalendar", () => {
  it("마감일 주의 일요일부터 재개일 주의 토요일까지 2주를 만든다", () => {
    const calendar = buildHolidayCalendar(chuseok);
    expect(calendar.month).toBe(9);
    expect(calendar.weeks).toHaveLength(2);
    expect(calendar.weeks[0]?.map((d) => d.day)).toEqual([
      20, 21, 22, 23, 24, 25, 26,
    ]);
    expect(calendar.weeks[1]?.map((d) => d.day)).toEqual([
      27, 28, 29, 30, 1, 2, 3,
    ]);
  });

  it("마감·휴무·재개를 시안의 표시 종류로 구분하고 띠는 주 경계에서 끊는다", () => {
    const weeks = buildHolidayCalendar(chuseok).weeks;
    const week1 = weeks[0] ?? [];
    const week2 = weeks[1] ?? [];
    expect(week1.map((d) => d.kind)).toEqual([
      "plain",
      "plain",
      "plain",
      "cutoff",
      "closed",
      "closed",
      "closed",
    ]);
    expect(week2.map((d) => d.kind)).toEqual([
      "closed",
      "resume",
      "plain",
      "plain",
      "plain",
      "plain",
      "plain",
    ]);
    // 24일이 띠 시작, 26일(토)이 주 경계 끝, 27일(일)은 시작과 끝을 겸한다.
    expect(week1[4]?.bandStart).toBe(true);
    expect(week1[6]?.bandEnd).toBe(true);
    expect(week2[0]?.bandStart).toBe(true);
    expect(week2[0]?.bandEnd).toBe(true);
  });

  it("표시 월 밖의 날(10월 1–3일)은 흐리게 표시한다", () => {
    const week2 = buildHolidayCalendar(chuseok).weeks[1] ?? [];
    expect(week2.map((d) => d.outsideMonth)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("3주를 넘는 기간도 휴무 종료일과 재개일까지 표시한다", () => {
    const calendar = buildHolidayCalendar({
      cutoff_on: "2026-09-01",
      closed_from: "2026-09-02",
      closed_to: "2026-09-25",
      resume_on: "2026-09-28",
    });
    expect(calendar.weeks).toHaveLength(5);
    expect(calendar.weeks.flat()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ iso: "2026-09-25", kind: "closed" }),
        expect.objectContaining({ iso: "2026-09-28", kind: "resume" }),
      ]),
    );
  });
});

describe("formatters", () => {
  it("요일과 시각을 한국어로 표기한다", () => {
    expect(formatDayWithWeekday("2026-09-23")).toBe("23일(수)");
    expect(formatKoreanTime("14:00")).toBe("오후 2시");
    expect(formatKoreanTime("09:30")).toBe("오전 9시 30분");
    expect(formatKoreanTime("00:00")).toBe("오전 12시");
  });
});
