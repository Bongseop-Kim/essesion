import { Box, Flex, Grid, Icon, Modal, Text, VStack } from "@essesion/shared";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";

import type {
  DesignHistoryCell,
  DesignStepCell,
} from "@/features/design/model/steps";
import { svgTileStyle } from "@/features/design/model/svg-preview";

export type HistoryModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 실패 칸까지 포함한 전체 이력 — 격자에만 보여준다. */
  cells: readonly DesignHistoryCell[];
  currentRunId: string | null;
  onSelect: (runId: string) => void;
};

/** 전체 편집 이력 격자. 칸을 고르면 그 스텝으로 되돌리고 닫는다. */
export function HistoryModal({
  open,
  onOpenChange,
  cells,
  currentRunId,
  onSelect,
}: HistoryModalProps) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="편집 이력"
      description="되돌릴 디자인을 고르세요. 되돌려도 이후 디자인은 그대로 남아요."
      size="medium"
      showCloseButton
    >
      <Grid columns={{ base: 3, md: 5 }} gap="x3" aria-label="편집 이력 전체">
        {cells.map((cell) =>
          cell.kind === "failed" ? (
            <FailedCell key={`failed-${cell.seq}`} />
          ) : (
            <StepCell
              key={cell.runId}
              cell={cell}
              current={cell.runId === currentRunId}
              onClick={() => {
                if (cell.runId !== currentRunId) onSelect(cell.runId);
                onOpenChange(false);
              }}
            />
          ),
        )}
      </Grid>
    </Modal>
  );
}

function StepCell({
  cell,
  current,
  onClick,
}: {
  cell: DesignStepCell;
  current: boolean;
  onClick: () => void;
}) {
  return (
    <VStack
      as="button"
      type="button"
      alignItems="stretch"
      gap="x1"
      onClick={onClick}
      aria-current={current ? "step" : undefined}
      aria-label={
        current
          ? `${cell.label}번째 디자인, 현재 편집 중`
          : `${cell.label}번째 디자인으로 되돌리기`
      }
      className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
    >
      <Box
        width="full"
        borderRadius="r2"
        borderWidth={current ? 2 : 1}
        borderColor={current ? "stroke.brand" : "stroke.neutral"}
        style={svgTileStyle(cell.svg)}
      />
      <Text
        textStyle="captionSm"
        align="center"
        color={current ? "fg.neutral" : "fg.neutral-subtle"}
      >
        {current ? `${cell.label} · 현재` : cell.label}
      </Text>
    </VStack>
  );
}

/** 실패한 요청 — 번호를 차지하지 않고 격자에서만 흔적을 남긴다. */
function FailedCell() {
  return (
    <VStack alignItems="stretch" gap="x1">
      <Flex
        alignItems="center"
        justifyContent="center"
        width="full"
        borderRadius="r2"
        bg="bg.critical-weak"
        style={{ aspectRatio: 1 }}
        className="border border-dashed border-stroke-critical"
      >
        <Icon
          svg={<ExclamationTriangleIcon />}
          size={18}
          color="fg.critical"
          aria-label="실패한 요청"
        />
      </Flex>
      <Text textStyle="captionSm" align="center" color="fg.critical">
        실패
      </Text>
    </VStack>
  );
}
