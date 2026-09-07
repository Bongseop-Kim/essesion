import { Flex, Icon, Text, VStack } from "@essesion/shared";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useState } from "react";

export type CanvasNoticeTone = "warning" | "critical";

export type CanvasNoticeItem = {
  id: string;
  tone: CanvasNoticeTone;
  message: ReactNode;
};

const TONES = {
  warning: {
    bg: "bg.warning-weak",
    border: "stroke.warning",
    fg: "fg.warning",
  },
  critical: {
    bg: "bg.critical-weak",
    border: "stroke.critical",
    fg: "fg.critical",
  },
} as const;

export type CanvasNoticeLayerProps = {
  notices: readonly CanvasNoticeItem[];
};

export type RejectedReason =
  | "motif_change"
  | "motif_recolor"
  | "motif_position"
  | "per_motif_placement"
  | "target_missing";

const REJECTED_NOTICE_BY_REASON: Record<RejectedReason, string> = {
  motif_change:
    "그림을 바꾸는 건 왼쪽 모티프에서 할 수 있어요. 토큰은 쓰지 않았어요.",
  motif_recolor:
    "모티프 색은 그림 자체에 고정돼 있어 여기서 바꿀 수 없어요. 토큰은 쓰지 않았어요.",
  motif_position:
    "줄 사이처럼 정확한 위치로 모티프를 옮기는 건 아직 지원하지 않아요. 토큰은 쓰지 않았어요.",
  per_motif_placement:
    "모티프 하나만 따로 돌리거나 성기게 하는 건 아직 지원하지 않아요. 회전·간격은 모든 모티프에 함께 적용돼요. 토큰은 쓰지 않았어요.",
  target_missing:
    "말씀하신 모티프가 지금 디자인에 없어서 바꾸지 않았어요. 토큰은 쓰지 않았어요.",
};

/** 알림 우선순위: 안내 못 한 거절·오류(빨강) 먼저, 자동 조정 경고(노랑)가 뒤에. */
export function designNotices(input: {
  /** 거절됐는데 피커로 안내할 시그널도 없었던 경우 — 조용히 끝나지 않게 한다. */
  rejected: boolean;
  /** 거절 사유 코드 — 없으면 기본(모티프 교체) 문구로 취급한다. */
  rejectedReason?: RejectedReason | null;
  errorMessage?: string | null;
  warnings: readonly { code: string; message: string }[];
}): CanvasNoticeItem[] {
  const notices: CanvasNoticeItem[] = [];
  if (input.rejected) {
    notices.push({
      id: "rejected",
      tone: "critical",
      message:
        REJECTED_NOTICE_BY_REASON[input.rejectedReason ?? "motif_change"],
    });
  }
  if (input.errorMessage) {
    notices.push({
      id: "error",
      tone: "critical",
      message: input.errorMessage,
    });
  }
  const seen = new Set<string>();
  for (const warning of input.warnings) {
    if (seen.has(warning.code)) continue;
    seen.add(warning.code);
    notices.push({
      id: warning.code,
      tone: "warning",
      message: warning.message,
    });
  }
  return notices;
}

/**
 * 캔버스 상단 중앙에 떠 있는 알림 — absolute 레이어라 넥타이·이력·입력창을 밀지 않는다.
 * 노랑은 자동 조정 안내, 빨강은 거절·실패. 버튼은 두지 않는다(문장이 그대로 남아 재시도가 곧 전송).
 */
export function CanvasNoticeLayer({ notices }: CanvasNoticeLayerProps) {
  // live region은 항상 마운트돼 있어야 새 알림이 낭독된다 — 빈 상태도 렌더한다.
  return (
    <VStack gap="x2" alignItems="center">
      <VStack gap="x2" alignItems="center" role="alert" aria-live="assertive">
        {notices
          .filter((notice) => notice.tone === "critical")
          .map((notice) => (
            <NoticeChip key={notice.id} notice={notice} />
          ))}
      </VStack>
      <VStack gap="x2" alignItems="center" role="status" aria-live="polite">
        {notices
          .filter((notice) => notice.tone !== "critical")
          .map((notice) => (
            <NoticeChip key={notice.id} notice={notice} />
          ))}
      </VStack>
    </VStack>
  );
}

/** 경고는 읽을 시간만 머문다. 다음 생성·교체가 warnings를 비우면 언마운트돼 다시 뜬다. */
const WARNING_VISIBLE_MS = 10_000;

function NoticeChip({ notice }: { notice: CanvasNoticeItem }) {
  const tone = TONES[notice.tone];
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    // 같은 id로 내용만 바뀌면 언마운트되지 않는다 — 새 문구는 다시 보이고 타이머도 새로.
    setExpired(false);
    // 거절·오류는 남긴다 — 다음 입력이 mutation을 리셋할 때까지가 수명이다.
    if (notice.tone === "critical") return;
    const timer = setTimeout(() => setExpired(true), WARNING_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [notice.id, notice.message, notice.tone]);

  if (expired) return null;

  return (
    <Flex
      alignItems="flex-start"
      gap="x2"
      px="x4_5"
      py="x2_5"
      bg={tone.bg}
      borderWidth={1}
      borderColor={tone.border}
      borderRadius="full"
      boxShadow="s2"
    >
      <Icon
        svg={<ExclamationTriangleIcon />}
        size={16}
        color={tone.border}
        className="mt-x0_5"
      />
      <Text textStyle="caption" color={tone.fg}>
        {notice.message}
      </Text>
    </Flex>
  );
}
