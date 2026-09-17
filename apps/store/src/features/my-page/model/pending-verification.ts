import { browserStorage } from "@/shared/lib/browser-storage";

/**
 * "인증번호를 이미 보냈다"는 사실만 남긴다 — 번호 원문은 저장하지 않는다(서버도 HMAC만 갖는다).
 *
 * 카톡 인앱 브라우저를 닫았다 다시 열면 웹뷰가 파괴되며 페이지가 새로 로드된다. 그때
 * 발송 사실을 잃으면 사용자는 "처음부터 다시"로 읽고 재전송을 누르다 60초 제한에 갇힌다.
 * 서버 상태의 복사본이므로 **어긋날 수 있고**, 어긋나면 없는 것으로 친다(항상 서버가 정본).
 */
const KEY = "my-page:phone-verification:pending";
/** api와 같은 값 — docs/api-spec/domains.md §1 (만료 5분 / 재전송 60초) */
const CODE_TTL_MS = 5 * 60 * 1000;
const RESEND_INTERVAL_MS = 60 * 1000;

type PendingVerification = {
  /** 발송했던 번호 — 재진입 시 입력칸을 되살린다 */
  phone: string;
  /** 남은 재전송 대기 초. 0이면 바로 재전송할 수 있다 */
  cooldown: number;
};

type StoredRecord = { userId: string; phone: string; sentAt: number };

export function savePendingVerification(userId: string, phone: string): void {
  try {
    const record: StoredRecord = { userId, phone, sentAt: Date.now() };
    browserStorage()?.setItem(KEY, JSON.stringify(record));
  } catch {
    // 저장소가 막혀도 발송은 이미 끝났다 — 이번 화면에서는 그대로 입력할 수 있다.
  }
}

export function clearPendingVerification(): void {
  try {
    browserStorage()?.removeItem(KEY);
  } catch {
    // 지우지 못해도 5분 뒤 만료 판정으로 무시된다.
  }
}

/** 다른 계정의 기록·만료된 기록·깨진 기록은 전부 없는 것으로 친다. */
export function readPendingVerification(
  userId: string | undefined,
  now: number = Date.now(),
): PendingVerification | null {
  if (userId === undefined) return null;
  let record: Partial<StoredRecord> | null = null;
  try {
    const raw = browserStorage()?.getItem(KEY);
    if (raw == null) return null;
    record = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    record === null ||
    record.userId !== userId ||
    typeof record.phone !== "string" ||
    typeof record.sentAt !== "number"
  ) {
    return null;
  }

  const elapsed = now - record.sentAt;
  if (!(elapsed >= 0 && elapsed < CODE_TTL_MS)) return null;
  return {
    phone: record.phone,
    cooldown: Math.max(0, Math.ceil((RESEND_INTERVAL_MS - elapsed) / 1000)),
  };
}
