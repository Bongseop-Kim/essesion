import type { AdminPopupNoticeOut } from "@essesion/api-client";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../../test/render-admin-page";

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@essesion/api-client/query", () => ({
  listAdminPopupsOptions: () => ({ queryKey: ["popups"], queryFn: api.list }),
  listAdminPopupsQueryKey: () => ["popups"],
  createAdminPopupMutation: () => ({ mutationFn: api.create }),
  updateAdminPopupMutation: () => ({ mutationFn: api.update }),
  deleteAdminPopupMutation: () => ({ mutationFn: api.remove }),
}));

import { PopupNewPage } from "./form";
import { PopupsPage } from "./list";

const popup: AdminPopupNoticeOut = {
  id: "popup-1",
  template: "holiday",
  title: "추석 연휴",
  title_emphasis: "배송 안내",
  body: null,
  fields: {
    template: "holiday",
    cutoff_on: "2026-09-23",
    cutoff_time: "14:00",
    closed_from: "2026-09-24",
    closed_to: "2026-09-27",
    resume_on: "2026-09-28",
    footnote: null,
  },
  link_url: null,
  starts_on: "2026-09-15",
  ends_on: "2026-09-27",
  enabled: false,
  active_now: false,
  created_at: "2026-09-09T00:00:00Z",
  updated_at: "2026-09-09T00:00:00Z",
};

describe("PopupsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.list.mockResolvedValue([popup]);
    api.update.mockResolvedValue({ ...popup, enabled: true });
    api.remove.mockResolvedValue(undefined);
    api.create.mockResolvedValue(popup);
  });

  it("활성 스위치는 즉시 PATCH한다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<PopupsPage />);
    await user.click(
      await screen.findByRole("switch", { name: "추석 연휴 활성" }),
    );
    await waitFor(() =>
      expect(api.update.mock.calls[0]?.[0]).toEqual({
        path: { popup_id: "popup-1" },
        body: { enabled: true },
      }),
    );
  });

  it("삭제는 확인 다이얼로그를 지나서만 호출된다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<PopupsPage />);
    await screen.findByRole("switch", { name: "추석 연휴 활성" });

    await user.click(screen.getByRole("button", { name: "삭제" }));
    expect(api.remove).not.toHaveBeenCalled();
    const confirms = await screen.findAllByRole("button", { name: "삭제" });
    await user.click(confirms[confirms.length - 1]!);
    await waitFor(() =>
      expect(api.remove.mock.calls[0]?.[0]).toEqual({
        path: { popup_id: "popup-1" },
      }),
    );
  });
});

describe("PopupNewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.create.mockResolvedValue(popup);
  });

  it("템플릿을 바꾸면 필드 묶음이 바뀌고, 날짜 순서가 어긋나면 제출하지 않는다", async () => {
    const user = userEvent.setup();
    renderAdminPage(<PopupNewPage />);

    expect(screen.getByLabelText(/연휴 전 출고 마감일/)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /배송·운영 안내/ }));
    expect(screen.queryByLabelText(/연휴 전 출고 마감일/)).toBeNull();
    expect(screen.getByLabelText("1행 라벨")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /휴무·명절 안내/ }));

    await user.type(screen.getByLabelText(/^제목/), "추석 연휴");
    await user.type(screen.getByLabelText(/^강조 제목/), "배송 안내");
    await user.type(screen.getByLabelText(/연휴 전 출고 마감일/), "2026-09-23");
    await user.type(screen.getByLabelText(/휴무 시작일/), "2026-09-24");
    await user.type(screen.getByLabelText(/휴무 종료일/), "2026-09-27");
    await user.type(screen.getByLabelText(/출고 재개일/), "2026-09-25");
    await user.type(screen.getByLabelText(/노출 시작일/), "2026-09-15");
    await user.type(screen.getByLabelText(/노출 종료일/), "2026-09-27");
    await user.click(screen.getByRole("button", { name: "비활성으로 등록" }));

    expect(
      within(screen.getByRole("alert")).getByText(/순서여야 합니다/),
    ).toBeTruthy();
    expect(api.create).not.toHaveBeenCalled();

    const resume = screen.getByLabelText(/출고 재개일/);
    await user.clear(resume);
    await user.type(resume, "2026-09-28");
    await user.click(screen.getByRole("button", { name: "비활성으로 등록" }));

    await waitFor(() =>
      expect(api.create.mock.calls[0]?.[0]).toEqual({
        body: {
          title: "추석 연휴",
          title_emphasis: "배송 안내",
          body: null,
          link_url: null,
          fields: {
            template: "holiday",
            cutoff_on: "2026-09-23",
            cutoff_time: "14:00",
            closed_from: "2026-09-24",
            closed_to: "2026-09-27",
            resume_on: "2026-09-28",
            footnote: null,
          },
          starts_on: "2026-09-15",
          ends_on: "2026-09-27",
        },
      }),
    );
  });
});

it("동시에 갱신하는 각 행을 완료 또는 실패할 때까지 비활성화한다", async () => {
  let resolveFirst!: () => void;
  let rejectSecond!: (error: Error) => void;
  api.update
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSecond = reject;
        }),
    );
  api.list.mockResolvedValue(
    ["a", "b"].map((id) => ({ ...popup, id, title: id })),
  );
  renderAdminPage(<PopupsPage />);
  const first = (await screen.findByRole("switch", {
    name: "a 활성",
  })) as HTMLInputElement;
  const second = screen.getByRole("switch", {
    name: "b 활성",
  }) as HTMLInputElement;
  fireEvent.click(first);
  await waitFor(() => expect(first.disabled).toBe(true));
  expect(second.disabled).toBe(false);
  fireEvent.click(second);
  await waitFor(() => expect(second.disabled).toBe(true));
  await act(async () => resolveFirst());
  await waitFor(() => expect(first.disabled).toBe(false));
  expect(second.disabled).toBe(true);
  await act(async () => rejectSecond(new Error("실패")));
  await waitFor(() => expect(second.disabled).toBe(false));
});
