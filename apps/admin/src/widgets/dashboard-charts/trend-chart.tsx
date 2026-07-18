import { Box, HStack, Text, VStack } from "@essesion/shared";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type TrendSeries = {
  key: string;
  label: string;
  /** 디자인 토큰 CSS 변수 참조 문자열 — 예: "var(--color-bg-brand-solid)" */
  color: string;
  kind: "line" | "bar";
  stackId?: string;
};

export type TrendTooltipRow = {
  label: string;
  value: string;
  color?: string;
};

type TrendPoint = Record<string, unknown> & { day: string };

type TrendChartProps<T extends TrendPoint> = {
  data: readonly T[];
  series: readonly TrendSeries[];
  height?: number;
  /** 툴팁 값 포맷 — 기본은 천 단위 구분 */
  valueFormatter?: (value: number) => string;
  /** 지정 시 기본 시리즈 행 대신 이 행들로 툴팁을 구성한다 (파생값 병기용) */
  tooltipRows?: (point: T) => TrendTooltipRow[];
};

const compactNumber = new Intl.NumberFormat("ko", { notation: "compact" });

function formatDay(day: string) {
  const [, month, date] = day.split("-");
  return `${Number(month)}/${Number(date)}`;
}

function ChartTooltip<T extends TrendPoint>({
  active,
  payload,
  rows,
}: {
  active?: boolean;
  payload?: readonly { payload?: T }[];
  rows: (point: T) => TrendTooltipRow[];
}) {
  const point = payload?.[0]?.payload;
  if (!active || point === undefined) return null;
  return (
    <Box
      bg="bg.layer-floating"
      borderRadius="r2"
      p="x3"
      className="border border-stroke-neutral-weak shadow-s2"
    >
      <VStack gap="x1">
        <Text textStyle="captionSm" color="fg.neutral-muted">
          {formatDay(point.day)}
        </Text>
        {rows(point).map((row) => (
          <HStack key={row.label} gap="x2">
            {row.color !== undefined && <SeriesDot color={row.color} />}
            <Text textStyle="caption" color="fg.neutral-muted">
              {row.label}
            </Text>
            <Text textStyle="caption">{row.value}</Text>
          </HStack>
        ))}
      </VStack>
    </Box>
  );
}

function SeriesDot({ color }: { color: string }) {
  return (
    <Box
      as="span"
      width={8}
      height={8}
      borderRadius="full"
      style={{ backgroundColor: color }}
    />
  );
}

export function TrendChart<T extends TrendPoint>({
  data,
  series,
  height = 240,
  valueFormatter = (value) => value.toLocaleString("ko"),
  tooltipRows,
}: TrendChartProps<T>) {
  const rows =
    tooltipRows ??
    ((point: T) =>
      series.map((item) => ({
        label: item.label,
        value: valueFormatter(Number(point[item.key] ?? 0)),
        color: item.color,
      })));
  const tick = { fill: "var(--color-fg-neutral-subtle)", fontSize: 12 }; // harness-ignore recharts SVG tick — Text/textStyle 적용 불가
  return (
    <VStack gap="x3" alignItems="stretch">
      {series.length >= 2 && (
        <HStack gap="x4" wrap>
          {series.map((item) => (
            <HStack key={item.key} gap="x2">
              <SeriesDot color={item.color} />
              <Text textStyle="captionSm" color="fg.neutral-muted">
                {item.label}
              </Text>
            </HStack>
          ))}
        </HStack>
      )}
      <Box width="100%" height={height}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={data as T[]}
            margin={{ top: 4, right: 4, bottom: 0, left: 4 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="var(--color-stroke-neutral-weak)"
            />
            <XAxis
              dataKey="day"
              tickFormatter={formatDay}
              tick={tick}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
              interval="preserveStartEnd"
            />
            <YAxis
              width={44}
              allowDecimals={false}
              tickFormatter={(value: number) => compactNumber.format(value)}
              tick={tick}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip
              cursor={{ fill: "var(--color-bg-neutral-weak)", opacity: 0.5 }}
              content={<ChartTooltip rows={rows} />}
            />
            {series.map((item, index) => {
              if (item.kind === "line") {
                return (
                  <Line
                    key={item.key}
                    dataKey={item.key}
                    stroke={item.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                );
              }
              const stacked = item.stackId !== undefined;
              const topOfStack =
                !stacked ||
                !series
                  .slice(index + 1)
                  .some((next) => next.stackId === item.stackId);
              return (
                <Bar
                  key={item.key}
                  dataKey={item.key}
                  stackId={item.stackId}
                  fill={item.color}
                  maxBarSize={28}
                  radius={topOfStack ? [4, 4, 0, 0] : undefined}
                  // 스택 구획 사이 표면색 경계 — dataviz 2px spacer의 근사
                  stroke={stacked ? "var(--color-bg-layer-default)" : undefined}
                  strokeWidth={stacked ? 1 : undefined}
                  isAnimationActive={false}
                />
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}
