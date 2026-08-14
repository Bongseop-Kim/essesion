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
  it("탭으로 돌아오면 30초 staleTime 안에서도 서버 상태를 다시 읽는다", () => {
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

    expect(refetchOnWindowFocus).toBe("always");
  });
});
