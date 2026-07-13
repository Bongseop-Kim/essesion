import { describe, expect, it } from "vitest";

import { createOperationEpoch } from "./operation-epoch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

describe("design operation epoch", () => {
  it.each([
    "generate",
    "retry",
  ])("늦게 끝난 %s가 사용자가 고른 세션을 되돌리지 않는다", async () => {
    const epoch = createOperationEpoch();
    const response = deferred<string>();
    const operation = epoch.begin();
    let activeSession = "session-a";
    const completion = response.promise.then((sessionId) => {
      if (epoch.isCurrent(operation)) activeSession = sessionId;
    });

    epoch.invalidate();
    activeSession = "session-b";
    response.resolve("session-a");
    await completion;

    expect(activeSession).toBe("session-b");
  });

  it("이전 선택 실패가 이후 후보의 optimistic 선택을 지우지 않는다", async () => {
    const epoch = createOperationEpoch();
    const response = deferred<void>();
    const firstOperation = epoch.begin();
    let selectedCandidate: string | null = "candidate-a";
    const completion = response.promise.catch(() => {
      if (epoch.isCurrent(firstOperation)) selectedCandidate = null;
    });

    epoch.begin();
    selectedCandidate = "candidate-b";
    response.reject(new Error("selection failed"));
    await completion;

    expect(selectedCandidate).toBe("candidate-b");
  });
});
