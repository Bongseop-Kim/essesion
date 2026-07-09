import { afterEach, describe, expect, it, vi } from "vitest";

import {
  advance,
  dismiss,
  enqueue,
  getSnapshot,
  registerAvoidOverlap,
  reset,
  subscribe,
  unregisterAvoidOverlap,
  updateAvoidOverlap,
} from "./snackbar-store";

afterEach(() => {
  reset();
});

describe("snackbar-store", () => {
  it("enqueue: current가 비면 즉시 current로 승격", () => {
    const id = enqueue("저장됨");
    const { current, queue } = getSnapshot();
    expect(current).toMatchObject({ id, message: "저장됨", duration: 4000 });
    expect(queue).toEqual([]);
  });

  it("enqueue: current가 있으면 큐에 순서대로 쌓인다", () => {
    enqueue("A");
    const b = enqueue("B");
    const c = enqueue("C");
    const { current, queue } = getSnapshot();
    expect(current?.message).toBe("A");
    expect(queue.map((i) => i.id)).toEqual([b, c]);
    expect(queue.map((i) => i.message)).toEqual(["B", "C"]);
  });

  it("enqueue: id는 매번 증가", () => {
    const a = enqueue("A");
    const b = enqueue("B");
    expect(b).toBe(a + 1);
  });

  it("enqueue: 옵션 duration·action 반영", () => {
    const action = { label: "되돌리기", onClick: () => {} };
    enqueue("삭제됨", { action, duration: 8000 });
    expect(getSnapshot().current).toMatchObject({ duration: 8000, action });
  });

  it("dismiss(): 인자 없으면 current 제거 후 큐 승격", () => {
    enqueue("A");
    const b = enqueue("B");
    dismiss();
    const { current, queue } = getSnapshot();
    expect(current?.id).toBe(b);
    expect(queue).toEqual([]);
  });

  it("dismiss(id): current와 일치하면 승격", () => {
    const a = enqueue("A");
    const b = enqueue("B");
    dismiss(a);
    expect(getSnapshot().current?.id).toBe(b);
  });

  it("dismiss(id): 큐에 있는 항목만 제거", () => {
    enqueue("A");
    const b = enqueue("B");
    const c = enqueue("C");
    dismiss(b);
    const { current, queue } = getSnapshot();
    expect(current?.message).toBe("A");
    expect(queue.map((i) => i.id)).toEqual([c]);
  });

  it("dismiss(존재하지 않는 id): 아무 변화 없음 + 동일 스냅샷", () => {
    enqueue("A");
    const before = getSnapshot();
    dismiss(9999);
    expect(getSnapshot()).toBe(before);
  });

  it("advance(): current를 큐 머리로 교체, 비면 null", () => {
    enqueue("A");
    const b = enqueue("B");
    advance();
    expect(getSnapshot().current?.id).toBe(b);
    advance();
    expect(getSnapshot().current).toBeNull();
  });

  it("reset(): 상태·id 카운터 초기화", () => {
    enqueue("A");
    enqueue("B");
    reset();
    expect(getSnapshot()).toEqual({ current: null, queue: [], avoidBottom: 0 });
    expect(enqueue("C")).toBe(1);
  });

  it("avoid overlap: 등록된 하단 영역의 최대 높이를 보존", () => {
    const a = registerAvoidOverlap();
    const b = registerAvoidOverlap();
    updateAvoidOverlap(a, 64.2);
    updateAvoidOverlap(b, 48);
    expect(getSnapshot().avoidBottom).toBe(65);

    unregisterAvoidOverlap(a);
    expect(getSnapshot().avoidBottom).toBe(48);

    unregisterAvoidOverlap(b);
    expect(getSnapshot().avoidBottom).toBe(0);
  });

  it("subscribe: 변경 시 알림 + 해지 후 미알림", () => {
    const fn = vi.fn();
    const unsub = subscribe(fn);
    enqueue("A");
    expect(fn).toHaveBeenCalledTimes(1);
    dismiss();
    expect(fn).toHaveBeenCalledTimes(2);
    unsub();
    enqueue("B");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("불변: 변경이 있을 때만 새 스냅샷 객체", () => {
    const s0 = getSnapshot();
    enqueue("A");
    const s1 = getSnapshot();
    expect(s1).not.toBe(s0);
    expect(getSnapshot()).toBe(s1);
  });
});
