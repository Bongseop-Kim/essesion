import type { AdminSettingOut } from "@essesion/api-client";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderAdminPage } from "../test/render-admin-page";

const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));
const session = vi.hoisted(() => ({ role: "admin" as "admin" | "manager" }));

vi.mock("@essesion/api-client/query", () => ({
  getAdminSettingsOptions: () => ({
    queryKey: ["settings"],
    queryFn: api.getSettings,
  }),
  getAdminSettingsQueryKey: () => ["settings"],
  updateAdminSettingsMutation: () => ({ mutationFn: api.updateSettings }),
}));

vi.mock("../shared/session/admin-session", () => ({
  useAdminSession: () => ({
    state: {
      status: "authenticated",
      session: {
        userId: "admin-1",
        displayName: "운영자",
        role: session.role,
      },
    },
  }),
}));

vi.mock("../shared/lib/use-dirty-form-blocker", () => ({
  useDirtyFormBlocker: () => ({ state: "unblocked" }),
}));

import { SettingsPage } from "./settings";

const settings: AdminSettingOut[] = [
  {
    key: "default_courier_company",
    value: "우체국택배",
    value_type: "courier",
    updated_at: "2026-07-12T01:00:00Z",
    updated_by: "admin-1",
  },
  {
    key: "design_token_initial_grant",
    value: "3",
    value_type: "non_negative_integer",
    updated_at: "2026-07-12T01:00:00Z",
    updated_by: "admin-1",
  },
  {
    key: "design_finalize_daily_limit",
    value: "10",
    value_type: "non_negative_integer",
    updated_at: "2026-07-12T01:00:00Z",
    updated_by: "admin-1",
  },
];

function renderPage() {
  return renderAdminPage(<SettingsPage />);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.role = "admin";
    vi.spyOn(crypto, "randomUUID")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000001")
      .mockReturnValueOnce("00000000-0000-4000-8000-000000000002")
      .mockReturnValue("00000000-0000-4000-8000-000000000003");
  });

  it("오류 상태에서 생성 클라이언트 쿼리를 다시 실행해 복구한다", async () => {
    const user = userEvent.setup();
    api.getSettings
      .mockRejectedValueOnce(new Error("설정 조회 오류"))
      .mockResolvedValueOnce(settings);
    renderPage();

    expect(
      await screen.findByRole("heading", { name: "설정", level: 1 }),
    ).toBeTruthy();
    expect(await screen.findByText("설정을 불러오지 못했습니다")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("우체국택배")).toBeTruthy();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });

  it("manager에게 설정을 읽기 전용으로 제공한다", async () => {
    session.role = "manager";
    api.getSettings.mockResolvedValue(settings);
    renderPage();

    expect(await screen.findByText("조회 전용 권한")).toBeTruthy();
    expect(screen.queryByLabelText("택배사명")).toBeNull();
    expect(screen.queryByLabelText("토큰 수량")).toBeNull();
    expect(screen.queryByRole("button", { name: "수정" })).toBeNull();
  });

  it("각 설정은 수정 버튼을 누른 한 섹션에서만 편집한다", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(settings);
    renderPage();

    expect(await screen.findByText("우체국택배")).toBeTruthy();
    expect(screen.queryByLabelText("택배사명")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "수정" })[0]!);

    expect(await screen.findByLabelText("택배사명")).toBeTruthy();
    expect(screen.queryByLabelText("토큰 수량")).toBeNull();
    expect(screen.queryAllByRole("button", { name: "수정" })).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "편집 취소" }));
    expect(screen.queryByLabelText("택배사명")).toBeNull();
  });

  it("실사화 한도 설정을 회 단위로 표시하고 전용 라벨로 편집한다", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(settings);
    renderPage();

    expect(await screen.findByText("실사화 24시간 한도")).toBeTruthy();
    // 현재 값·시스템 기본값 모두 "10회" — 회 단위 포맷 확인
    expect(screen.getAllByText("10회").length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "수정" })[2]!);
    expect(await screen.findByLabelText("실사화 횟수")).toBeTruthy();
  });

  it("편집 중 캐시가 갱신되어도 편집 시작 revision으로 저장한다", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(settings);
    api.updateSettings.mockRejectedValue(new Error("동시 수정 충돌"));
    const { queryClient } = renderPage();

    await user.click(
      (await screen.findAllByRole("button", { name: "수정" }))[0]!,
    );
    const courier = await screen.findByLabelText("택배사명");
    await user.clear(courier);
    await user.type(courier, "한진택배");
    await user.type(screen.getByLabelText(/변경 사유/), "계약 택배사 변경");

    act(() => {
      queryClient.setQueryData(
        ["settings"],
        settings.map((item) =>
          item.key === "default_courier_company"
            ? {
                ...item,
                value: "로젠택배",
                updated_at: "2026-07-12T02:00:00Z",
              }
            : item,
        ),
      );
    });

    await user.click(screen.getByRole("button", { name: "설정 변경 검토" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/우체국택배 → 한진택배/)).toBeTruthy();
    expect(within(dialog).getByText("계약 택배사 변경")).toBeTruthy();
    await user.click(
      within(dialog).getByRole("button", {
        name: "설정 변경 적용",
      }),
    );

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            items: [
              expect.objectContaining({
                expected_updated_at: settings[0]?.updated_at,
              }),
            ],
          }),
        }),
        expect.anything(),
      ),
    );
  });

  it("실패한 동일 설정은 같은 작업 ID로 재시도하고 값 변경 시 새 ID를 사용한다", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(settings);
    api.updateSettings.mockRejectedValue(new Error("일시적인 저장 실패"));
    renderPage();

    await user.click(
      (await screen.findAllByRole("button", { name: "수정" }))[0]!,
    );
    const courier = await screen.findByLabelText("택배사명");
    await user.clear(courier);
    await user.type(courier, "한진택배");
    await user.type(screen.getByLabelText(/변경 사유/), "계약 택배사 변경");
    await user.click(screen.getByRole("button", { name: "설정 변경 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "설정 변경 적용",
      }),
    );
    expect(await screen.findByText("일시적인 저장 실패")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "설정 변경 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "설정 변경 적용",
      }),
    );
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(2));
    expect(api.updateSettings.mock.calls[1]?.[0].body.operation_id).toBe(
      api.updateSettings.mock.calls[0]?.[0].body.operation_id,
    );
    expect(api.updateSettings.mock.calls[0]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000002",
    );

    await user.clear(courier);
    await user.type(courier, "CJ대한통운");
    expect(screen.queryByText("일시적인 저장 실패")).toBeNull();
    await user.click(screen.getByRole("button", { name: "설정 변경 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "설정 변경 적용",
      }),
    );
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledTimes(3));
    expect(api.updateSettings.mock.calls[2]?.[0].body.operation_id).toBe(
      "00000000-0000-4000-8000-000000000003",
    );
  });

  it("저장 성공 데이터를 편집 종료 전에 설정 캐시에 반영한다", async () => {
    const user = userEvent.setup();
    const updated = settings.map((item) =>
      item.key === "default_courier_company"
        ? { ...item, value: "한진택배" }
        : item,
    );
    api.getSettings.mockResolvedValue(settings);
    api.updateSettings.mockResolvedValue(updated);
    const { queryClient } = renderPage();
    const setQueryData = vi.spyOn(queryClient, "setQueryData");

    await user.click(
      (await screen.findAllByRole("button", { name: "수정" }))[0]!,
    );
    const courier = await screen.findByLabelText("택배사명");
    await user.clear(courier);
    await user.type(courier, "한진택배");
    await user.type(screen.getByLabelText(/변경 사유/), "계약 택배사 변경");
    await user.click(screen.getByRole("button", { name: "설정 변경 검토" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "설정 변경 적용",
      }),
    );

    await waitFor(() =>
      expect(setQueryData).toHaveBeenCalledWith(["settings"], updated),
    );
    await waitFor(() => expect(screen.queryByLabelText("택배사명")).toBeNull());
  });
});
