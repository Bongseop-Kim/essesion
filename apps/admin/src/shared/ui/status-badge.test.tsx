import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it.each([
    ["active", "활성", "bg-bg-positive-weak"],
    ["resolved", "해결", "bg-bg-positive-weak"],
    ["pending", "대기 중", "bg-bg-warning-weak"],
    ["inactive", "비활성", "bg-bg-critical-weak"],
    ["succeeded", "성공", "bg-bg-positive-weak"],
    ["partial", "부분 성공", "bg-bg-warning-weak"],
    ["DONE", "완료", "bg-bg-positive-weak"],
  ])("%s 상태를 %s(으)로 표시한다", (status, label, toneClass) => {
    render(<StatusBadge status={status} />);

    expect(screen.getByText(label).className).toContain(toneClass);
  });

  it("등록되지 않은 상태는 원문을 표시한다", () => {
    render(<StatusBadge status="custom-status" />);

    expect(screen.getByText("custom-status")).toBeTruthy();
  });
});
