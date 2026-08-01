import {
  ActionButton,
  Box,
  Callout,
  HStack,
  Icon,
  ResponsiveModal,
  TextField,
  VStack,
} from "@essesion/shared";
import { PaintBrushIcon } from "@heroicons/react/24/outline";

import type { MotifSearchState } from "@/features/design/model/use-motif-search";

export type MotifGenerateModalProps = {
  open: boolean;
  /** 닫힘 = 취소 — 모티프 모달을 검색어·결과 그대로 다시 연다. */
  onOpenChange: (open: boolean) => void;
  state: MotifSearchState;
};

/**
 * 토큰·예산이 나가는 유일한 문. 검색어를 그대로 쓰는 확인창이 아니라 생성 프롬프트를
 * 다시 쓸 수 있는 입력창이다 — 인용 블록·설명 문단·잔액 계산 줄은 두지 않는다.
 */
export function MotifGenerateModal({
  open,
  onOpenChange,
  state,
}: MotifGenerateModalProps) {
  const prompt = state.generatePrompt.trim();

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={(next) => {
        if (!next && state.working) return;
        onOpenChange(next);
      }}
      title="모티프 새로 만들기"
      size="small"
      showCloseButton={!state.working}
      closeOnEscape={!state.working}
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralOutline"
            width="full"
            disabled={state.working}
            onClick={() => onOpenChange(false)}
          >
            취소
          </Box>
          <Box
            as={ActionButton}
            type="button"
            width="full"
            loading={state.working}
            disabled={!prompt || state.exhausted}
            onClick={() => void state.generate()}
          >
            이 문장으로 만들기
          </Box>
        </HStack>
      }
    >
      <VStack gap="x4" alignItems="stretch">
        <TextField
          aria-label="새로 만들 그림"
          placeholder="예: 작은 벌"
          value={state.generatePrompt}
          maxLength={100}
          disabled={state.working}
          prefix={<Icon svg={<PaintBrushIcon />} size={20} />}
          onChange={(event) =>
            state.setGeneratePrompt(event.currentTarget.value)
          }
        />
        {state.generateError ? (
          <Callout
            tone="critical"
            title="모티프를 만들지 못했습니다"
            description={state.generateError}
          />
        ) : null}
      </VStack>
    </ResponsiveModal>
  );
}
