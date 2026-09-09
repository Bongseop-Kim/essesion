import { resolveStorage, type StorageLike } from "@/shared/lib/browser-storage";

/**
 * "오늘 하루 보지 않기" — 팝업 id별로 KST 날짜를 저장한다.
 * 브라우저 로컬 날짜가 아니라 KST로 만드는 이유: 서버의 노출 판정도 KST 날짜라
 * 해외 접속에서도 "오늘"이 같은 하루를 가리켜야 한다.
 */

const KST_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

type Options = {
  storage?: StorageLike | null;
  now?: Date;
};

export function kstToday(now: Date = new Date()): string {
  return KST_DATE.format(now);
}

export function dismissalKey(popupId: string): string {
  return `popup:dismissed:${popupId}`;
}

export function isDismissedToday(
  popupId: string,
  options: Options = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;
  try {
    return storage.getItem(dismissalKey(popupId)) === kstToday(options.now);
  } catch {
    return false;
  }
}

export function dismissForToday(
  popupId: string,
  options: Options = {},
): boolean {
  const storage = resolveStorage(options.storage);
  if (!storage) return false;
  try {
    storage.setItem(dismissalKey(popupId), kstToday(options.now));
    return true;
  } catch {
    return false;
  }
}
