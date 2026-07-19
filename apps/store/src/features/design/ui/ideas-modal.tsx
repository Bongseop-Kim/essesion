import {
  ActionButton,
  Box,
  Callout,
  HStack,
  ProgressCircle,
  ResponsiveModal,
  SelectBox,
  SelectBoxItem,
  Text,
  TextAreaField,
  VStack,
} from "@essesion/shared";
import { useCallback, useEffect, useRef, useState } from "react";

import { designErrorMessage } from "@/features/design/model/errors";

export type IdeasModalProps = {
  open: boolean;
  currentPrompt: string;
  onOpenChange: (open: boolean) => void;
  onRequest: () => Promise<string[]>;
  onApply: (prompt: string) => void;
};

export function IdeasModal({
  open,
  currentPrompt,
  onOpenChange,
  onRequest,
  onApply,
}: IdeasModalProps) {
  const requestRef = useRef(onRequest);
  requestRef.current = onRequest;
  const requestSequence = useRef(0);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await requestRef.current();
      if (sequence !== requestSequence.current) return;
      setIdeas(next);
      setSelectedIndex(0);
      setDraft(next[0] ?? "");
      if (next.length === 0) {
        setError("새 아이디어를 만들지 못했습니다. 다시 시도해 주세요.");
      }
    } catch (cause) {
      if (sequence !== requestSequence.current) return;
      setIdeas([]);
      setDraft("");
      setError(designErrorMessage(cause, "아이디어를 만들지 못했습니다."));
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      void load();
      return;
    }
    requestSequence.current += 1;
    setIdeas([]);
    setDraft("");
    setLoading(false);
    setError(null);
  }, [load, open]);

  const apply = (mode: "replace" | "append") => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onApply(
      mode === "append" && currentPrompt.trim()
        ? `${currentPrompt.trim()} ${trimmed}`
        : trimmed,
    );
    onOpenChange(false);
  };

  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="문맥 기반 아이디어"
      description="현재 사진의 참고 방식, 모티프, 색상, 패턴 설정과 입력 내용을 함께 살펴봐요."
      size="medium"
      showCloseButton
      footer={
        currentPrompt.trim() ? (
          <HStack gap="x2">
            <Box
              as={ActionButton}
              type="button"
              variant="neutralOutline"
              width="full"
              disabled={!draft.trim() || loading}
              onClick={() => apply("append")}
            >
              기존 문장 뒤에 추가
            </Box>
            <Box
              as={ActionButton}
              type="button"
              width="full"
              disabled={!draft.trim() || loading}
              onClick={() => apply("replace")}
            >
              기존 문장 바꾸기
            </Box>
          </HStack>
        ) : (
          <Box
            as={ActionButton}
            type="button"
            width="full"
            disabled={!draft.trim() || loading}
            onClick={() => apply("replace")}
          >
            입력창에 넣기
          </Box>
        )
      }
    >
      <VStack gap="x4" alignItems="stretch">
        {loading ? (
          <VStack gap="x3" py="x8">
            <ProgressCircle aria-label="아이디어 생성 중" />
            <Text textStyle="bodySm" color="fg.neutral-subtle">
              서로 다른 아이디어를 만들고 있어요.
            </Text>
          </VStack>
        ) : null}

        {!loading && ideas.length > 0 ? (
          <>
            <SelectBox
              value={String(selectedIndex)}
              onValueChange={(value) => {
                const index = Number(value);
                setSelectedIndex(index);
                setDraft(ideas[index] ?? "");
              }}
              columns={1}
              aria-label="프롬프트 아이디어"
            >
              {ideas.map((idea, index) => (
                <SelectBoxItem
                  key={idea}
                  value={String(index)}
                  label={`아이디어 ${index + 1}`}
                  description={idea}
                />
              ))}
            </SelectBox>
            <TextAreaField
              label="선택한 초안 편집"
              value={draft}
              rows={3}
              maxLength={180}
              onChange={(event) => setDraft(event.currentTarget.value)}
            />
          </>
        ) : null}

        {!loading && error ? (
          <Callout
            tone="critical"
            title="아이디어를 불러오지 못했습니다"
            description={error}
            onClick={() => void load()}
          >
            <Text as="span" textStyle="labelSm">
              다시 시도
            </Text>
          </Callout>
        ) : null}

        <Callout
          tone="neutral"
          title="아이디어는 생성 요청이 아니에요"
          description="입력창에 적용한 뒤 보내기 버튼을 눌러야 디자인 생성이 시작돼요."
        />
      </VStack>
    </ResponsiveModal>
  );
}
