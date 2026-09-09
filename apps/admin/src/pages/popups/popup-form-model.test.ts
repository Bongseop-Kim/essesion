import type { AdminPopupNoticeOut } from "@essesion/api-client";
import { describe, expect, it } from "vitest";

import {
  draftFromPopup,
  EMPTY_DRAFT,
  type PopupDraft,
  requestFromDraft,
  validateDraft,
} from "./popup-form-model";

const holidayDraft: PopupDraft = {
  ...EMPTY_DRAFT,
  title: "추석 연휴",
  titleEmphasis: "배송 안내",
  body: "연휴 기간 **택배사 휴무**",
  startsOn: "2026-09-15",
  endsOn: "2026-09-27",
  cutoffOn: "2026-09-23",
  cutoffTime: "14:00",
  closedFrom: "2026-09-24",
  closedTo: "2026-09-27",
  resumeOn: "2026-09-28",
};

describe("validateDraft", () => {
  it("올바른 휴무 초안은 오류가 없다", () => {
    expect(validateDraft(holidayDraft)).toEqual({});
  });

  it("종료일이 시작일보다 앞서면 막는다", () => {
    expect(
      validateDraft({ ...holidayDraft, endsOn: "2026-09-01" }).endsOn,
    ).toMatch(/앞설 수 없습니다/);
  });

  it("휴무 날짜 순서가 어긋나면 재개일에 오류를 붙인다", () => {
    expect(
      validateDraft({ ...holidayDraft, resumeOn: "2026-09-25" }).resumeOn,
    ).toMatch(/순서/);
  });

  it("운영 안내는 빈 행을, 이벤트는 이미지·링크 누락을 막는다", () => {
    expect(
      validateDraft({ ...holidayDraft, template: "operation" })["rows.0.label"],
    ).toBeTruthy();
    const event = validateDraft({ ...holidayDraft, template: "event" });
    expect(event.image).toBeTruthy();
    expect(event.linkUrl).toMatch(/링크가 필요/);
    expect(
      validateDraft({ ...holidayDraft, linkUrl: "javascript:alert(1)" })
        .linkUrl,
    ).toMatch(/내부 경로/);
  });

  it("운영 안내 오류를 행과 필드별로 구분한다", () => {
    expect(
      validateDraft({
        ...holidayDraft,
        template: "operation",
        rows: [
          { label: " ", value: "시행일" },
          { label: "요금", value: " " },
        ],
      }),
    ).toEqual({
      "rows.0.label": "1행 라벨을 입력해 주세요.",
      "rows.1.value": "2행 값을 입력해 주세요.",
    });
  });
});

describe("requestFromDraft / draftFromPopup", () => {
  it("템플릿별 fields를 만들고 빈 문자열은 null로 보낸다", () => {
    const body = requestFromDraft({ ...holidayDraft, holidayFootnote: "  " });
    expect(body.fields).toEqual({
      template: "holiday",
      cutoff_on: "2026-09-23",
      cutoff_time: "14:00",
      closed_from: "2026-09-24",
      closed_to: "2026-09-27",
      resume_on: "2026-09-28",
      footnote: null,
    });
    expect(body.link_url).toBeNull();
    expect(body.title_emphasis).toBe("배송 안내");
  });

  it("서버 응답을 초안으로 되돌리면 같은 요청이 나온다", () => {
    const popup: AdminPopupNoticeOut = {
      id: "p1",
      template: "operation",
      title: "배송비 정책",
      title_emphasis: "변경 안내",
      body: null,
      fields: {
        template: "operation",
        rows: [{ label: "시행일", value: "10월 1일" }],
        footnote: "제주 추가 운임 동일",
      },
      link_url: "/notice",
      starts_on: "2026-09-20",
      ends_on: "2026-10-05",
      enabled: true,
      active_now: false,
      created_at: "2026-09-09T00:00:00Z",
      updated_at: "2026-09-09T00:00:00Z",
    };
    const draft = draftFromPopup(popup);
    expect(validateDraft(draft)).toEqual({});
    expect(requestFromDraft(draft)).toEqual({
      title: "배송비 정책",
      title_emphasis: "변경 안내",
      body: null,
      link_url: "/notice",
      fields: popup.fields,
      starts_on: "2026-09-20",
      ends_on: "2026-10-05",
    });
  });
});
