import { Box, Grid, Text } from "@essesion/shared";

export type OperationTableProps = {
  rows: readonly { label: string; value: string }[];
};

/** 시안 2번의 라벨·값 표 — 정책 변경·마감처럼 조건이 여러 줄일 때. */
export function OperationTable({ rows }: OperationTableProps) {
  return (
    <Box
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      overflow="hidden"
    >
      {rows.map((row, index) => (
        <Grid
          key={`${row.label}-${index}`}
          templateColumns="120px minmax(0, 1fr)"
          className={
            index < rows.length - 1
              ? "border-b border-stroke-neutral-weak"
              : undefined
          }
        >
          <Box bg="bg.neutral-weak" px="x4" py="x3">
            <Text textStyle="labelSm" color="fg.neutral-muted">
              {row.label}
            </Text>
          </Box>
          <Box px="x4" py="x3">
            <Text textStyle="bodySm" color="fg.neutral">
              {row.value}
            </Text>
          </Box>
        </Grid>
      ))}
    </Box>
  );
}
