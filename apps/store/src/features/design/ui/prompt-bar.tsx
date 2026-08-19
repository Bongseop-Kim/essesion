import { ActionButton, Box, Flex, HStack, Icon } from "@essesion/shared";
import {
  PaperAirplaneIcon,
  PlusIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { type KeyboardEvent, useEffect, useRef } from "react";

/** 서버 검증과 동일 — api MAX_DESIGN_PROMPT_LENGTH(4_000) */
const MAX_PROMPT_LENGTH = 4000;
/** 약 8줄. 넘으면 입력창 안에서 세로 스크롤한다. */
const MAX_HEIGHT = 200;

export type PromptBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenIdeas: () => void;
  onOpenTools: () => void;
  toolsOpen: boolean;
  placeholder: string;
  /** 적용 중 — 입력을 잠그고 전송 버튼을 스피너로 바꾼다 */
  loading?: boolean;
  disabled?: boolean;
  /**
   * 범위 밖 거절 카운터. 값이 바뀔 때마다 문장을 전체 선택해, 다음 입력이 바로
   * 덮어쓰도록 한다(문장은 지우지 않는다 — 무엇이 거절됐는지 남겨야 한다).
   */
  selectSignal?: number;
};

/**
 * 캔버스 하단 입력창 pill — 색·줄무늬·배치·크기만 다룬다(모티프는 좌측 패널).
 * 한 줄로 시작해 내용만큼 자라고, 8줄에서 멈춘 뒤 안에서 스크롤한다.
 * PC는 Enter 전송 / Shift+Enter 줄바꿈, 모바일은 Enter 줄바꿈 + 전송 버튼.
 */
export function PromptBar({
  value,
  onChange,
  onSubmit,
  onOpenIdeas,
  onOpenTools,
  toolsOpen,
  placeholder,
  loading = false,
  disabled = false,
  selectSignal = 0,
}: PromptBarProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (selectSignal > 0) inputRef.current?.select();
  }, [selectSignal]);

  // 한 줄로 시작해 내용만큼 자란다(GPT·Claude 컴포저와 같은 동작).
  // ponytail: `field-sizing: content` 한 줄이 이 effect를 대체하지만 Baseline이 2026-06이라
  //   구형 iOS Safari에서 조용히 안 자란다. Safari 26.2+/Firefox 152+가 하한이 되면 CSS로 교체.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  // 폭이 바뀌면(회전·리사이즈) 줄바꿈이 달라진다 — 값 편집 없이도 높이를 다시 잰다.
  useEffect(() => {
    const el = inputRef.current;
    // jsdom(테스트)에는 ResizeObserver가 없다 — 없으면 값 변경 시 리사이즈만 동작.
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const locked = loading || disabled;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    // 한글 조합 중 Enter는 조합 확정이다 — 전송하면 미완성 문장이 나간다.
    if (event.nativeEvent.isComposing) return;
    // 가상 키보드에는 Shift가 없다 — 모바일은 Enter를 줄바꿈으로 두고 전송은 버튼으로.
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    event.preventDefault();
    if (!locked && value.trim()) onSubmit();
  };
  return (
    <Flex
      as="form"
      alignItems="flex-end"
      gap="x1"
      width="full"
      px="x1_5"
      bg={locked ? "bg.layer-basement" : "bg.layer-floating"}
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r6"
      boxShadow={locked ? "s1" : "s2"}
      py="x1"
      minHeight={48}
      className="transition-colors duration-100 ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Box display={{ base: "block", md: "none" }}>
        <ActionButton
          variant="neutralWeak"
          size="small"
          iconOnly
          aria-label="디자인 도구 열기"
          aria-haspopup="dialog"
          aria-expanded={toolsOpen}
          onClick={onOpenTools}
          className="rounded-full"
        >
          <Icon svg={<PlusIcon />} size={20} />
        </ActionButton>
      </Box>
      <textarea
        ref={inputRef}
        rows={1}
        aria-label="무엇을 바꿀까요?"
        placeholder={placeholder}
        value={value}
        disabled={locked}
        maxLength={MAX_PROMPT_LENGTH}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={handleKeyDown}
        style={{ maxHeight: MAX_HEIGHT, scrollbarWidth: "thin" }}
        className="w-full min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-x3 py-x1_5 text-t4 text-fg-neutral outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled"
      />
      <HStack gap="x1">
        <ActionButton
          variant="ghost"
          size="small"
          iconOnly
          aria-label="아이디어 받기"
          onClick={onOpenIdeas}
          disabled={locked}
          className="rounded-full"
        >
          <Icon svg={<SparklesIcon />} size={20} />
        </ActionButton>
        <ActionButton
          type="submit"
          size="small"
          iconOnly
          aria-label="디자인에 적용"
          loading={loading}
          disabled={disabled || !value.trim()}
          className="rounded-full"
        >
          <Icon svg={<PaperAirplaneIcon />} size={18} />
        </ActionButton>
      </HStack>
    </Flex>
  );
}
