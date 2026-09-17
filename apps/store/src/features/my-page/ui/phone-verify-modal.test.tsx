// @vitest-environment jsdom
import type { MeResponse } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSession } from "@/shared/store/session";

const sendPhone = vi.hoisted(() => vi.fn());
const verifyPhone = vi.hoisted(() => vi.fn());
const snackbar = vi.hoisted(() => vi.fn());

vi.mock("@essesion/api-client/query", () => ({
  getMeOptions: () => ({
    queryKey: ["me"],
    queryFn: async () => ({ id: "u1" }),
  }),
  getMeQueryKey: () => ["me"],
  sendPhoneVerificationMutation: () => ({ mutationFn: sendPhone }),
  verifyPhoneMutation: () => ({ mutationFn: verifyPhone }),
}));
vi.mock("@essesion/shared", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@essesion/shared")>()),
  snackbar,
  Modal: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div role="dialog">
      {children}
      {footer}
    </div>
  ),
}));

import { PhoneVerifyModal } from "./phone-verify-modal";

const PENDING_KEY = "my-page:phone-verification:pending";

Object.defineProperty(window, "matchMedia", {
  value: () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
});

beforeEach(() => {
  localStorage.clear();
  useSession.setState({
    status: "authenticated",
    accessToken: "a",
    user: { id: "u1" } as MeResponse,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <PhoneVerifyModal open currentPhone={null} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

/** 카톡 인앱 브라우저 재진입·새로고침으로 발송 상태를 잃어도 갇히지 않아야 한다. */
it("보관 기록이 없어도 받은 인증번호를 바로 입력할 수 있다", async () => {
  verifyPhone.mockResolvedValue({ message: "ok" });
  renderModal();

  // 번호 없이 6자리만 넣으면 서버에 보내지 않는다
  fireEvent.change(screen.getByLabelText("인증번호"), {
    target: { value: "123456" },
  });
  expect(screen.getByRole("button", { name: "인증 완료" })).toHaveProperty(
    "disabled",
    true,
  );

  // 번호를 고치면 코드는 그 번호에 묶여 있으므로 지워진다 — 다시 넣는다
  fireEvent.change(screen.getByLabelText("휴대폰 번호"), {
    target: { value: "010-1234-5678" },
  });
  expect(screen.getByLabelText("인증번호")).toHaveProperty("value", "");
  fireEvent.change(screen.getByLabelText("인증번호"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증 완료" }));

  await waitFor(() => expect(verifyPhone).toHaveBeenCalledTimes(1));
  expect(verifyPhone.mock.calls[0]?.[0]).toEqual({
    body: { phone: "01012345678", code: "123456" },
  });
  expect(sendPhone).not.toHaveBeenCalled();
});

it("보관 기록이 있으면 번호와 남은 대기 시간을 되살린다", () => {
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      userId: "u1",
      phone: "01012345678",
      sentAt: Date.now() - 30_000,
    }),
  );
  renderModal();

  expect(screen.getByLabelText("휴대폰 번호")).toHaveProperty(
    "value",
    "010-1234-5678",
  );
  expect(screen.getByText("이미 인증번호를 보냈습니다")).toBeTruthy();
  // 발송 버튼은 숨기지 않는다 — 문자가 안 온 사람의 탈출구다
  expect(screen.getByRole("button", { name: "30초" })).toBeTruthy();
});

it("재전송이 막히면 서버가 준 이유를 그대로 보여준다", async () => {
  sendPhone.mockRejectedValue({
    code: "rate_limited",
    detail: "1분 후 재전송 가능합니다",
  });
  renderModal();

  fireEvent.change(screen.getByLabelText("휴대폰 번호"), {
    target: { value: "010-1234-5678" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증번호 발송" }));

  await waitFor(() =>
    expect(snackbar).toHaveBeenCalledWith("1분 후 재전송 가능합니다"),
  );
  // 재전송 대기가 걸려 발송 버튼은 막히고, 열려 있는 인증번호 칸만 남는다
  expect(screen.getByRole("button", { name: "60초" })).toBeTruthy();
});

it("만료된 인증번호로 실패하면 보관 기록을 버린다", async () => {
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({
      userId: "u1",
      phone: "01012345678",
      sentAt: Date.now() - 10_000,
    }),
  );
  verifyPhone.mockRejectedValue({
    code: "verification_expired",
    detail: "인증번호가 만료되었습니다",
  });
  renderModal();

  fireEvent.change(screen.getByLabelText("인증번호"), {
    target: { value: "123456" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인증 완료" }));

  await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
  expect(screen.queryByText("이미 인증번호를 보냈습니다")).toBeNull();
});
