import { Box, Text } from "@essesion/shared";

export function ResultEmoji({ emoji }: { emoji: string }) {
  return (
    <Box
      width={88}
      height={88}
      display="flex"
      alignItems="center"
      justifyContent="center"
      aria-hidden
    >
      <Text textStyle="display1" className="result-emoji">
        {emoji}
      </Text>
    </Box>
  );
}
