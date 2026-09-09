import type {
  AdminPopupNoticeOut,
  PopupNoticeCreateRequest,
} from "@essesion/api-client";

export type PopupTemplate = AdminPopupNoticeOut["template"];

export const TEMPLATE_LABELS: Record<PopupTemplate, string> = {
  holiday: "휴무·명절 안내",
  operation: "배송·운영 안내",
  event: "이벤트·프로모션",
};

export const TEMPLATE_DESCRIPTIONS: Record<PopupTemplate, string> = {
  holiday: "마감·휴무·재개일을 넣으면 달력과 범례가 자동으로 그려집니다.",
  operation: "시행일·변경 내용처럼 라벨과 값을 표로 보여줍니다 (최대 4행).",
  event: "배너 이미지가 주인공입니다. 링크가 필요합니다.",
};

export const MAX_OPERATION_ROWS = 4;

export type PopupImageDraft = {
  uploadId: string;
  src: string;
  /** 아직 팝업에 연결되지 않은 업로드 — 제거하면 스테이징 행을 만료시킨다 */
  staged: boolean;
};

export type PopupDraft = {
  template: PopupTemplate;
  title: string;
  titleEmphasis: string;
  body: string;
  linkUrl: string;
  startsOn: string;
  endsOn: string;
  // holiday
  cutoffOn: string;
  cutoffTime: string;
  closedFrom: string;
  closedTo: string;
  resumeOn: string;
  holidayFootnote: string;
  // operation
  rows: { label: string; value: string }[];
  operationFootnote: string;
  // event
  image: PopupImageDraft | null;
};

export const EMPTY_DRAFT: PopupDraft = {
  template: "holiday",
  title: "",
  titleEmphasis: "",
  body: "",
  linkUrl: "",
  startsOn: "",
  endsOn: "",
  cutoffOn: "",
  cutoffTime: "14:00",
  closedFrom: "",
  closedTo: "",
  resumeOn: "",
  holidayFootnote: "",
  rows: [{ label: "", value: "" }],
  operationFootnote: "",
  image: null,
};

export function draftFromPopup(popup: AdminPopupNoticeOut): PopupDraft {
  const base: PopupDraft = {
    ...EMPTY_DRAFT,
    template: popup.template,
    title: popup.title,
    titleEmphasis: popup.title_emphasis ?? "",
    body: popup.body ?? "",
    linkUrl: popup.link_url ?? "",
    startsOn: popup.starts_on,
    endsOn: popup.ends_on,
  };
  const { fields } = popup;
  if (fields.template === "holiday") {
    return {
      ...base,
      cutoffOn: fields.cutoff_on,
      cutoffTime: fields.cutoff_time,
      closedFrom: fields.closed_from,
      closedTo: fields.closed_to,
      resumeOn: fields.resume_on,
      holidayFootnote: fields.footnote ?? "",
    };
  }
  if (fields.template === "operation") {
    return {
      ...base,
      rows: fields.rows.map((row) => ({ ...row })),
      operationFootnote: fields.footnote ?? "",
    };
  }
  return {
    ...base,
    image: {
      uploadId: fields.image_upload_id,
      src: fields.image_url,
      staged: false,
    },
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export type DraftErrors = Partial<Record<keyof PopupDraft, string>>;

/** 서버(`popups/schemas.py`)와 같은 규칙 — 제출 전에 같은 문구로 막는다. */
export function validateDraft(draft: PopupDraft): DraftErrors {
  const errors: DraftErrors = {};
  if (!draft.title.trim()) errors.title = "제목을 입력해 주세요.";
  if (!DATE_RE.test(draft.startsOn))
    errors.startsOn = "노출 시작일을 입력해 주세요.";
  if (!DATE_RE.test(draft.endsOn))
    errors.endsOn = "노출 종료일을 입력해 주세요.";
  if (!errors.startsOn && !errors.endsOn && draft.endsOn < draft.startsOn) {
    errors.endsOn = "종료일은 시작일보다 앞설 수 없습니다.";
  }
  if (draft.linkUrl && !/^(https:\/\/.+|\/([^/].*)?)$/.test(draft.linkUrl)) {
    errors.linkUrl =
      "링크는 /로 시작하는 내부 경로 또는 https:// 주소만 가능합니다.";
  }

  if (draft.template === "holiday") {
    for (const key of [
      "cutoffOn",
      "closedFrom",
      "closedTo",
      "resumeOn",
    ] as const) {
      if (!DATE_RE.test(draft[key])) errors[key] = "날짜를 입력해 주세요.";
    }
    if (!TIME_RE.test(draft.cutoffTime))
      errors.cutoffTime = "마감 시각을 입력해 주세요.";
    const ordered =
      draft.cutoffOn <= draft.closedFrom &&
      draft.closedFrom <= draft.closedTo &&
      draft.closedTo < draft.resumeOn;
    if (
      !errors.cutoffOn &&
      !errors.closedFrom &&
      !errors.closedTo &&
      !errors.resumeOn &&
      !ordered
    ) {
      errors.resumeOn =
        "마감일 ≤ 휴무 시작 ≤ 휴무 종료 < 재개일 순서여야 합니다.";
    }
  } else if (draft.template === "operation") {
    if (
      draft.rows.length === 0 ||
      draft.rows.some((row) => !row.label.trim() || !row.value.trim())
    ) {
      errors.rows = "모든 행의 라벨과 값을 입력해 주세요.";
    }
  } else {
    if (!draft.image) errors.image = "배너 이미지를 올려 주세요.";
    if (!draft.linkUrl.trim())
      errors.linkUrl = "이벤트 팝업은 링크가 필요합니다.";
  }
  return errors;
}

function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** 검증을 통과한 초안을 등록/수정 요청 본문으로. PATCH도 같은 본문을 보낸다(fields는 통째로 교체). */
export function requestFromDraft(draft: PopupDraft): PopupNoticeCreateRequest {
  const fields: PopupNoticeCreateRequest["fields"] =
    draft.template === "holiday"
      ? {
          template: "holiday",
          cutoff_on: draft.cutoffOn,
          cutoff_time: draft.cutoffTime,
          closed_from: draft.closedFrom,
          closed_to: draft.closedTo,
          resume_on: draft.resumeOn,
          footnote: orNull(draft.holidayFootnote),
        }
      : draft.template === "operation"
        ? {
            template: "operation",
            rows: draft.rows.map((row) => ({
              label: row.label.trim(),
              value: row.value.trim(),
            })),
            footnote: orNull(draft.operationFootnote),
          }
        : {
            template: "event",
            image_upload_id: draft.image?.uploadId ?? "",
          };
  return {
    title: draft.title.trim(),
    title_emphasis: orNull(draft.titleEmphasis),
    body: orNull(draft.body),
    link_url: orNull(draft.linkUrl),
    fields,
    starts_on: draft.startsOn,
    ends_on: draft.endsOn,
  };
}
