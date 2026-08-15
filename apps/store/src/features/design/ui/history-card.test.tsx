// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesignStepCell } from "@/features/design/model/steps";

import { HistoryCard } from "./history-card";

const cell = (label: number): DesignStepCell => ({
  kind: "design",
  seq: label,
  runId: `run-${label}`,
  svg: `<svg id='s${label}'/>`,
  label,
});

const cells = [cell(1), cell(2), cell(3)];

/** 브레이크포인트 스텁 — breakpoint.ts가 mql을 캐시하므로 getter로 바꿔 읽는다. */
let desktop = true;

function disabled(element: HTMLElement) {
  return (element as HTMLButtonElement).disabled;
}

function renderCard(props: Partial<Parameters<typeof HistoryCard>[0]> = {}) {
  const onSelect = vi.fn();
  const onOpenAll = vi.fn();
  const onCollapsedChange = vi.fn();
  const view = render(
    <HistoryCard
      cells={cells}
      currentIndex={1}
      collapsed={false}
      onCollapsedChange={onCollapsedChange}
      onSelect={onSelect}
      onOpenAll={onOpenAll}
      {...props}
    />,
  );
  return { ...view, onSelect, onOpenAll, onCollapsedChange };
}

describe("HistoryCard stepper", () => {
  beforeEach(() => {
    desktop = true;
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return desktop && query.includes("min-width");
      },
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("양끝에서는 그쪽 화살표가 잠긴다", () => {
    const first = renderCard({ currentIndex: 0 });
    expect(disabled(screen.getByRole("button", { name: "이전 디자인" }))).toBe(
      true,
    );
    expect(
      disabled(screen.getByRole("button", { name: "2번째 디자인으로 이동" })),
    ).toBe(false);

    first.unmount();
    renderCard({ currentIndex: cells.length - 1 });
    expect(disabled(screen.getByRole("button", { name: "다음 디자인" }))).toBe(
      true,
    );
  });

  it("화살표가 이웃 스텝의 runId로 onSelect를 부른다", () => {
    const { onSelect } = renderCard();
    screen.getByText("2 / 3");

    fireEvent.click(
      screen.getByRole("button", { name: "1번째 디자인으로 되돌리기" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "3번째 디자인으로 이동" }),
    );

    expect(onSelect.mock.calls).toEqual([["run-1"], ["run-3"]]);
  });

  it("적용 중에는 이동과 전체 보기가 잠긴다", () => {
    renderCard({ pending: true });
    screen.getByText("적용 중");

    for (const name of [
      "1번째 디자인으로 되돌리기",
      "3번째 디자인으로 이동",
      "전체 보기",
    ]) {
      expect(disabled(screen.getByRole("button", { name }))).toBe(true);
    }
  });

  it("디자인이 없으면 카드 자체가 없다", () => {
    const { container } = renderCard({ cells: [], currentIndex: -1 });
    expect(container.firstChild).toBeNull();
  });

  it("접으면 제목 줄만 남고 토글이 상태를 뒤집는다", () => {
    const { onCollapsedChange } = renderCard({ collapsed: true });

    // 카운터는 접혀도 남는다 — 스테퍼·전체 보기는 미니 칩으로 축소된다.
    screen.getByText("2 / 3");
    expect(screen.queryByRole("button", { name: "전체 보기" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "1번째 디자인으로 되돌리기" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "이력 카드 펼치기" }));
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("모바일에서는 접힘과 무관하게 썸네일·화살표가 남고 썸네일이 모달 진입점이다", () => {
    desktop = false;
    const { onOpenAll } = renderCard({ collapsed: true });

    expect(screen.queryByRole("button", { name: "전체 보기" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "1번째 디자인으로 되돌리기" }),
    ).toBeTruthy();
    const previous = screen.getByRole("button", {
      name: "1번째 디자인으로 되돌리기",
    });
    expect(previous.parentElement?.style.flexDirection).toBe("row");
    expect(screen.getByRole("region", { name: "편집 이력" }).style.width).toBe(
      "84px",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "2번째 디자인 · 전체 이력 보기" }),
    );
    expect(onOpenAll).toHaveBeenCalledOnce();
  });
});
