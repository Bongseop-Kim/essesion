// @vitest-environment jsdom

import type { GenerationJobOut } from "@essesion/api-client";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FinalizedGallery } from "./finalized-gallery";

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
  result_url: "https://example.com/legacy.png",
  tie_url: "https://example.com/tie.png",
  fabric_url: "https://example.com/fabric.png",
  tile_url: "https://example.com/tile.png",
};

const legacyJob: GenerationJobOut = {
  ...job,
  id: "job-legacy",
  tie_url: null,
  fabric_url: null,
  tile_url: null,
};

const image = () => screen.getByRole<HTMLImageElement>("img");

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FinalizedGallery 이미지 배선", () => {
  it("넥타이/원단 토글로 서로 다른 실사 이미지를 보여준다", () => {
    render(
      <FinalizedGallery
        variant="browse"
        jobs={[job]}
        onOrder={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(image().src).toBe(job.tie_url);
    fireEvent.click(screen.getByRole("radio", { name: "원단" }));
    expect(image().src).toBe(job.fabric_url);
  });

  it("레거시 완성본은 result_url로 폴백한다", () => {
    render(
      <FinalizedGallery
        variant="browse"
        jobs={[legacyJob]}
        onOrder={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(image().src).toBe(legacyJob.result_url);
  });
});

describe("FinalizedGallery 페이지네이션", () => {
  it("더 보기와 기존 주문·삭제 액션을 함께 제공한다", () => {
    const onLoadMore = vi.fn();
    const onOrder = vi.fn();
    const onDelete = vi.fn();

    render(
      <FinalizedGallery
        variant="browse"
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
      <FinalizedGallery
        variant="browse"
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
      <FinalizedGallery
        variant="browse"
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

describe("FinalizedGallery select variant", () => {
  it("카드를 선택하면 onSelect를 호출하고 선택 상태를 표시한다", () => {
    const onSelect = vi.fn();

    render(
      <FinalizedGallery
        variant="select"
        jobs={[job]}
        selectedId={job.id}
        onSelect={onSelect}
      />,
    );

    const card = screen.getByRole("button", { name: "완성 디자인 1" });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(job);
  });

  it("빈 상태 설명이 variant별로 다르다", () => {
    render(
      <FinalizedGallery
        variant="select"
        jobs={[]}
        selectedId={null}
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByText("디자인 페이지에서 실사화를 먼저 완성해 주세요."),
    ).toBeTruthy();
  });
});
