// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingVerification,
  readPendingVerification,
  savePendingVerification,
} from "./pending-verification";

const KEY = "my-page:phone-verification:pending";
const NOW = 1_800_000_000_000;

function store(record: unknown) {
  localStorage.setItem(KEY, JSON.stringify(record));
}

beforeEach(() => localStorage.clear());

describe("보관한 발송 기록", () => {
  it("남은 재전송 대기 초를 돌려주고, 60초가 지나면 0이 된다", () => {
    store({ userId: "u1", phone: "01012345678", sentAt: NOW - 30_000 });
    expect(readPendingVerification("u1", NOW)).toEqual({
      phone: "01012345678",
      cooldown: 30,
    });

    store({ userId: "u1", phone: "01012345678", sentAt: NOW - 90_000 });
    expect(readPendingVerification("u1", NOW)?.cooldown).toBe(0);
  });

  it("만료·다른 계정·깨진 기록은 없는 것으로 친다", () => {
    store({ userId: "u1", phone: "01012345678", sentAt: NOW - 300_000 });
    expect(readPendingVerification("u1", NOW)).toBeNull();

    store({ userId: "u1", phone: "01012345678", sentAt: NOW - 10_000 });
    expect(readPendingVerification("u2", NOW)).toBeNull();
    expect(readPendingVerification(undefined, NOW)).toBeNull();

    store({ userId: "u1", phone: "01012345678", sentAt: "이상한 값" });
    expect(readPendingVerification("u1", NOW)).toBeNull();

    localStorage.setItem(KEY, "{not json");
    expect(readPendingVerification("u1", NOW)).toBeNull();
  });

  it("저장하고 지운다", () => {
    savePendingVerification("u1", "01012345678");
    expect(readPendingVerification("u1")?.phone).toBe("01012345678");

    clearPendingVerification();
    expect(readPendingVerification("u1")).toBeNull();
  });
});
