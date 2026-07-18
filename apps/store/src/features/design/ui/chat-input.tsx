import { Flex } from "@essesion/shared";
import type { ComponentPropsWithRef, ReactNode } from "react";

export type ChatInputProps = Omit<
  ComponentPropsWithRef<"input">,
  "prefix" | "size"
> & {
  /** 필 안 왼쪽에 놓이는 버튼 (예: 옵션 더보기). */
  leading?: ReactNode;
  /** 필 안 오른쪽에 놓이는 버튼 (예: 전송). */
  trailing?: ReactNode;
};

/** 채팅창용 한 줄 입력 필. 양옆 버튼이 입력창 내부에 있는 것처럼 보이는
 *  메신저 스타일 — 높이 고정(리사이즈 없음), Enter로 폼 제출. */
export function ChatInput({
  leading,
  trailing,
  ...inputProps
}: ChatInputProps) {
  return (
    <Flex
      gap="x1"
      align="center"
      width="full"
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="full"
      bg="bg.layer-default"
      px="x1_5"
      className="h-12 transition-colors duration-100 ease-standard focus-within:outline focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-stroke-brand"
    >
      {leading}
      <input
        {...inputProps}
        className="w-full min-w-0 flex-1 bg-transparent px-x1 text-t4 text-fg-neutral outline-none placeholder:text-fg-placeholder disabled:text-fg-disabled"
      />
      {trailing}
    </Flex>
  );
}
