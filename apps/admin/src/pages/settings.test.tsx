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
];

function renderPage() {
  return renderAdminPage(<SettingsPage />);
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    session.role = "admin";
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "00000000-0000-4000-8000-000000000001",
    );
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

    expect(await screen.findByLabelText("택배사명")).toBeTruthy();
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2));
  });

  it("manager에게 typed 설정 입력을 조회 전용으로 제공한다", async () => {
    session.role = "manager";
    api.getSettings.mockResolvedValue(settings);
    renderPage();

    expect(await screen.findByText("조회 전용 권한")).toBeTruthy();
    expect(
      (screen.getByLabelText("택배사명") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText("토큰 수량") as HTMLInputElement).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "변경 내용 확인" })).toBeNull();
  });

  it("편집 중 캐시가 갱신되어도 편집 시작 revision으로 저장한다", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(settings);
    api.updateSettings.mockRejectedValue(new Error("동시 수정 충돌"));
    const { queryClient } = renderPage();

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

    await user.click(screen.getByRole("button", { name: "변경 내용 확인" }));
    await user.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "저장",
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
});
