import { useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { AppProviders } from "./app-providers";

vi.mock("@essesion/shared", () => ({ SnackbarHost: () => null }));
vi.mock("../../shared/session/admin-session", () => ({
  AdminSessionProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("admin query defaults", () => {
  it('탭 복귀 재요청은 staleTime(30초)을 존중한다 — "always"는 포커스마다 전부 재요청해 금지', () => {
    let refetchOnWindowFocus: unknown;
    function Probe() {
      refetchOnWindowFocus =
        useQueryClient().getDefaultOptions().queries?.refetchOnWindowFocus;
      return null;
    }

    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    );

    expect(refetchOnWindowFocus).toBe(true);
  });
});
