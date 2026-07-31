import { ActionButton, Flex, HStack, Icon } from "@essesion/shared";
import { PaperAirplaneIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useEffect, useRef } from "react";

export type PromptBarProps = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onOpenIdeas: () => void;
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

/** 캔버스 하단 입력창 pill — 색·줄무늬·배치·크기만 다룬다(모티프는 좌측 패널). */
export function PromptBar({
  value,
  onChange,
  onSubmit,
  onOpenIdeas,
  placeholder,
  loading = false,
  disabled = false,
  selectSignal = 0,
}: PromptBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (selectSignal > 0) inputRef.current?.select();
  }, [selectSignal]);

  const locked = loading || disabled;
  return (
    <Flex
      as="form"
      alignItems="center"
      gap="x1"
      width="full"
      px="x1_5"
      bg={locked ? "bg.layer-basement" : "bg.layer-floating"}
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="full"
      boxShadow={locked ? "s1" : "s2"}
      className="h-12 transition-colors duration-100 ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input
        ref={inputRef}
        aria-label="무엇을 바꿀까요?"
        placeholder={placeholder}
        value={value}
        disabled={locked}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full min-w-0 flex-1 bg-transparent px-x3 text-t4 text-fg-neutral outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled"
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
