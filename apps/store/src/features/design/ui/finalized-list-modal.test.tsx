// @vitest-environment jsdom

import type { GenerationJobOut } from "@essesion/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinalizedListModal } from "./finalized-list-modal";

const job: GenerationJobOut = {
  id: "job-1",
  session_id: null,
  kind: "finalize",
  status: "succeeded",
  params: {},
  attempts: 1,
  created_at: "2026-07-19T01:00:00Z",
  updated_at: "2026-07-19T01:01:00Z",
  error_message: null,
  request_id: null,
  result: null,
  result_url: "https://example.com/finalized.png",
};

describe("FinalizedListModal pagination", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("더 보기와 기존 주문·삭제 액션을 함께 제공한다", () => {
    const onLoadMore = vi.fn();
    const onOrder = vi.fn();
    const onDelete = vi.fn();

    render(
      <FinalizedListModal
        open
        onOpenChange={vi.fn()}
        jobs={[job]}
        hasMore
        onLoadMore={onLoadMore}
        onOrder={onOrder}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "더 보기" }));
    fireEvent.click(screen.getByRole("button", { name: "주문제작" }));
    fireEvent.click(screen.getByRole("button", { name: "완성본 1 삭제" }));

    expect(onLoadMore).toHaveBeenCalledOnce();
    expect(onOrder).toHaveBeenCalledWith(job);
    expect(onDelete).toHaveBeenCalledWith(job);
  });

  it("추가 조회 중에는 더 보기 버튼을 비활성화한다", () => {
    render(
      <FinalizedListModal
        open
        onOpenChange={vi.fn()}
        jobs={[job]}
        hasMore
        loadingMore
        onLoadMore={vi.fn()}
        onOrder={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "더 보기" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("추가 조회 실패 시 기존 목록을 유지하고 재시도한다", () => {
    const onLoadMore = vi.fn();

    render(
      <FinalizedListModal
        open
        onOpenChange={vi.fn()}
        jobs={[job]}
        hasMore
        loadMoreError
        onLoadMore={onLoadMore}
        onOrder={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "주문제작" })).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: /이전 완성본을 불러오지 못했어요/,
      }),
    );
    expect(onLoadMore).toHaveBeenCalledOnce();
  });
});
