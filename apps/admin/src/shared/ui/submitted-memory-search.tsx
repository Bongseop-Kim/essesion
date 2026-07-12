import { ActionButton, HStack, TextField } from "@essesion/shared";
import { type FormEvent, useState } from "react";

type SubmittedMemorySearchProps = {
  label: string;
  description: string;
  maxLength: number;
  onSubmit: (value: string | undefined) => void;
};

export function SubmittedMemorySearch({
  label,
  description,
  maxLength,
  onSubmit,
}: SubmittedMemorySearchProps) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    const nextValue = value.length >= 2 ? value : undefined;
    setSubmitted(nextValue !== undefined);
    onSubmit(nextValue);
  };

  return (
    <HStack as="form" gap="x2" align="flex-end" wrap onSubmit={submit}>
      <TextField
        label={label}
        description={description}
        value={input}
        maxLength={maxLength}
        onChange={(event) => setInput(event.currentTarget.value)}
      />
      <ActionButton type="submit" variant="neutralOutline">
        검색
      </ActionButton>
      {submitted && (
        <ActionButton
          type="button"
          variant="ghost"
          onClick={() => {
            setInput("");
            setSubmitted(false);
            onSubmit(undefined);
          }}
        >
          검색 초기화
        </ActionButton>
      )}
    </HStack>
  );
}
