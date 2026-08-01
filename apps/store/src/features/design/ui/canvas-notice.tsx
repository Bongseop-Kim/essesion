import { Flex, Icon, Text, VStack } from "@essesion/shared";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

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

const REJECTED_NOTICE =
  "그림을 바꾸는 건 왼쪽 모티프에서 할 수 있어요. 토큰은 쓰지 않았어요.";

/** 알림 우선순위: 범위 밖 거절·오류(빨강) 먼저, 자동 조정 경고(노랑)가 뒤에. */
export function designNotices(input: {
  rejected: boolean;
  errorMessage?: string | null;
  warnings: readonly { code: string; message: string }[];
}): CanvasNoticeItem[] {
  const notices: CanvasNoticeItem[] = [];
  if (input.rejected) {
    notices.push({
      id: "rejected",
      tone: "critical",
      message: REJECTED_NOTICE,
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

function NoticeChip({ notice }: { notice: CanvasNoticeItem }) {
  const tone = TONES[notice.tone];
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
