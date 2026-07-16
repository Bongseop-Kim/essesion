import { ActionButton, Box, HStack, TextField } from "@essesion/shared";
import { type FormEvent, useEffect, useState } from "react";

type SubmittedMemorySearchProps = {
  label: string;
  placeholder: string;
  maxLength: number;
  onSubmit: (value: string | undefined) => void;
  resetKey?: number;
  validate?: (value: string) => string | undefined;
};

export function SubmittedMemorySearch({
  label,
  placeholder,
  maxLength,
  onSubmit,
  resetKey,
  validate,
}: SubmittedMemorySearchProps) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    setInput("");
    setSubmitted(false);
    setError(undefined);
  }, [resetKey]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const value = input.trim();
    const nextValue = value.length >= 2 ? value : undefined;
    const validationError =
      nextValue === undefined ? undefined : validate?.(nextValue);
    if (validationError !== undefined) {
      setError(validationError);
      return;
    }
    setError(undefined);
    setSubmitted(nextValue !== undefined);
    onSubmit(nextValue);
  };

  return (
    <HStack
      as="form"
      width="full"
      gap="x2"
      align="flex-end"
      wrap
      onSubmit={submit}
    >
      <Box minWidth={0} flex={1}>
        <TextField
          label={label}
          placeholder={placeholder}
          value={input}
          maxLength={maxLength}
          errorMessage={error}
          onChange={(event) => {
            setInput(event.currentTarget.value);
            setError(undefined);
          }}
        />
      </Box>
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
            setError(undefined);
            onSubmit(undefined);
          }}
        >
          검색 초기화
        </ActionButton>
      )}
    </HStack>
  );
}
