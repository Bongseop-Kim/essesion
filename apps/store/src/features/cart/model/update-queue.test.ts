import { describe, expect, it } from "vitest";

import { createCartUpdateQueue } from "./update-queue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("cart update queue", () => {
  it("앞 변경이 저장된 뒤 최신 장바구니에서 다음 변경을 계산한다", async () => {
    const queue = createCartUpdateQueue();
    const firstPersist = deferred();
    const payloads: string[][] = [];
    let stored: string[] = [];

    const update = (item: string, waitFor?: Promise<void>) =>
      queue.enqueue(async () => {
        const next = [...stored, item];
        payloads.push(next);
        await waitFor;
        stored = next;
      });

    const first = update("coupon", firstPersist.promise);
    const second = update("quantity");
    await Promise.resolve();

    expect(payloads).toEqual([["coupon"]]);

    firstPersist.resolve();
    await Promise.all([first, second]);

    expect(payloads).toEqual([["coupon"], ["coupon", "quantity"]]);
    expect(stored).toEqual(["coupon", "quantity"]);
  });

  it("앞 변경이 실패해도 뒤 변경 큐를 계속 처리한다", async () => {
    const queue = createCartUpdateQueue();
    const failed = queue.enqueue(async () => {
      throw new Error("replace failed");
    });
    const next = queue.enqueue(async () => "saved");

    await expect(failed).rejects.toThrow("replace failed");
    await expect(next).resolves.toBe("saved");
  });
});
