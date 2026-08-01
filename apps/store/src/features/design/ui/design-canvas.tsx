import {
  Box,
  ContentPlaceholder,
  type DesignPreviewMode,
  Flex,
  HStack,
  Icon,
  TieCanvas,
  VStack,
} from "@essesion/shared";
import { SparklesIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

export type DesignCanvasProps = {
  /** 현재 스텝의 디자인(data URI). null이면 첫 진입 안내를 그린다. */
  imageSrc: string | null;
  mode: DesignPreviewMode;
  /** 좌상단 플로팅 pill (만드는 방법) */
  topStart?: ReactNode;
  /** 우상단 플로팅 (토큰 pill · 뷰 세그먼트) */
  topEnd?: ReactNode;
  /** 상단 중앙 알림 레이어 — 캔버스·이력·입력창을 밀지 않는다 */
  notice?: ReactNode;
  /** 좌측 상단 정렬 패널 (모티프 카드) */
  left?: ReactNode;
  /** 우측 상단 정렬 레일 (도구) */
  right?: ReactNode;
  /** 하단 중앙 (이력 트랙 + 입력창) */
  bottom?: ReactNode;
};

/**
 * 풀블리드 캔버스. 넥타이는 남은 높이의 가운데에 놓이고, 좌·우 패널은 상단 pill 아래
 * 상단 정렬로 겹쳐 뜬다. 겹치는 레이어는 포인터 이벤트를 통과시켜 캔버스 클릭을 막지 않는다.
 */
export function DesignCanvas({
  imageSrc,
  mode,
  topStart,
  topEnd,
  notice,
  left,
  right,
  bottom,
}: DesignCanvasProps) {
  return (
    <Box flex={1} minHeight={0} overflow="hidden" bg="bg.layer-basement">
      {/* 배경은 풀블리드, 콘텐츠는 다른 페이지(LayoutContent medium)와 같은 1280 최대폭 */}
      <Box position="relative" height="full" maxWidth={1280} mx="auto">
        <VStack height="full" alignItems="stretch">
          <Flex
            flex={1}
            minHeight={0}
            alignItems="center"
            justifyContent="center"
            p="x6"
          >
            {imageSrc ? (
              <Box height="full" maxWidth="full" style={{ aspectRatio: 1 }}>
                <TieCanvas imageSrc={imageSrc} mode={mode} surface="none" />
              </Box>
            ) : (
              <ContentPlaceholder
                icon={<Icon svg={<SparklesIcon />} size={32} />}
                title="아직 만든 디자인이 없어요"
                description="원하는 넥타이를 한 문장으로 알려주세요. 만든 다음에는 여기서 계속 고쳐 나갈 수 있어요."
              />
            )}
          </Flex>
          <VStack alignItems="center" gap="x2_5" px="x4" pb="x5">
            {bottom}
          </VStack>
        </VStack>

        {/* 겹쳐 뜨는 컨트롤 — 래퍼는 클릭을 통과시키고 각 그룹만 받는다 */}
        <Box position="absolute" inset="x5" style={{ pointerEvents: "none" }}>
          <VStack height="full" alignItems="stretch" gap="x4">
            <HStack
              alignItems="flex-start"
              justifyContent="space-between"
              gap="x3"
            >
              <Interactive>{topStart}</Interactive>
              <Interactive>
                <HStack gap="x2">{topEnd}</HStack>
              </Interactive>
            </HStack>
            <HStack
              alignItems="flex-start"
              justifyContent="space-between"
              gap="x3"
              flex={1}
              minHeight={0}
            >
              <Interactive>{left}</Interactive>
              <Interactive>{right}</Interactive>
            </HStack>
          </VStack>
        </Box>

        {notice ? (
          <Box
            position="absolute"
            top="x5"
            left="50%"
            maxWidth="full"
            px="x5"
            zIndex={1}
            style={{ transform: "translateX(-50%)" }}
          >
            {notice}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

function Interactive({ children }: { children?: ReactNode }) {
  if (!children) return <Box />;
  return <Box style={{ pointerEvents: "auto" }}>{children}</Box>;
}
