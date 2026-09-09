import { Box, cn, Flex, Grid, HStack, Text, VStack } from "@essesion/shared";

import {
  buildHolidayCalendar,
  type CalendarDay,
  formatDayWithWeekday,
  formatKoreanTime,
  type HolidayDates,
  WEEKDAY_LABELS,
} from "../model/calendar";

const BOLD = { fontWeight: 700 } as const;

function DayCell({ day }: { day: CalendarDay }) {
  const band =
    day.kind === "closed" || (day.bandStart && day.bandEnd)
      ? cn(
          day.bandStart && day.bandEnd && "rounded-full",
          day.bandStart && !day.bandEnd && "rounded-l-full",
          day.bandEnd && !day.bandStart && "rounded-r-full",
        )
      : undefined;

  if (day.kind === "cutoff") {
    return (
      <Flex height={44} align="center" justify="center">
        <Flex
          width={32}
          height={32}
          borderRadius="full"
          bg="bg.neutral-inverted"
          align="center"
          justify="center"
        >
          <Text textStyle="labelSm" color="fg.contrast" style={BOLD}>
            {day.day}
          </Text>
        </Flex>
      </Flex>
    );
  }
  if (day.kind === "resume") {
    return (
      <Flex height={44} align="center" justify="center">
        <Flex
          width={32}
          height={32}
          borderRadius="full"
          borderWidth={1.5}
          borderColor="stroke.brand"
          align="center"
          justify="center"
        >
          <Text textStyle="labelSm" color="fg.neutral" style={BOLD}>
            {day.day}
          </Text>
        </Flex>
      </Flex>
    );
  }
  if (day.kind === "closed") {
    return (
      <Flex
        height={44}
        align="center"
        justify="center"
        bg="bg.neutral-weak"
        className={band}
      >
        <Text textStyle="labelSm" color="fg.neutral">
          {day.day}
        </Text>
      </Flex>
    );
  }
  return (
    <Flex height={44} align="center" justify="center">
      <Text
        textStyle="bodySm"
        color={day.outsideMonth ? "fg.placeholder" : "fg.neutral"}
      >
        {day.day}
      </Text>
    </Flex>
  );
}

export type HolidayCalendarProps = HolidayDates & { cutoff_time: string };

/** 시안 1번의 달력 + 범례 — 날짜 4개에서 전부 파생되므로 운영자가 문장을 쓰지 않는다. */
export function HolidayCalendar(props: HolidayCalendarProps) {
  const calendar = buildHolidayCalendar(props);
  const cutoffDay = Number(props.cutoff_on.slice(-2));

  return (
    <VStack gap="x4" alignItems="stretch">
      <Box
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        borderRadius="r3"
        p="x4"
      >
        <VStack gap="x2" alignItems="stretch">
          <HStack gap="x1_5" align="baseline">
            <Text textStyle="title2">{calendar.month}</Text>
            <Text textStyle="caption" color="fg.neutral-muted">
              월
            </Text>
          </HStack>
          <Grid columns={7}>
            {WEEKDAY_LABELS.map((label) => (
              <Text
                key={label}
                textStyle="captionSm"
                color="fg.neutral-subtle"
                align="center"
                pb="x1"
              >
                {label}
              </Text>
            ))}
            {calendar.weeks.flat().map((day) => (
              <DayCell key={day.iso} day={day} />
            ))}
          </Grid>
        </VStack>
      </Box>

      <VStack gap="x2" alignItems="stretch">
        <HStack gap="x2_5">
          <Flex
            width={20}
            height={20}
            flexShrink={0}
            borderRadius="full"
            bg="bg.neutral-inverted"
            align="center"
            justify="center"
          >
            <Text textStyle="captionSm" color="fg.contrast" style={BOLD}>
              {cutoffDay}
            </Text>
          </Flex>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            <Text as="span" textStyle="bodySm" color="fg.neutral" style={BOLD}>
              {formatDayWithWeekday(props.cutoff_on)}{" "}
              {formatKoreanTime(props.cutoff_time)}
            </Text>{" "}
            결제분까지 연휴 전 출고
          </Text>
        </HStack>
        <HStack gap="x2_5">
          <Box
            width={20}
            height={20}
            flexShrink={0}
            borderRadius="full"
            bg="bg.neutral-weak"
          />
          <Text textStyle="bodySm" color="fg.neutral-muted">
            <Text as="span" textStyle="bodySm" color="fg.neutral" style={BOLD}>
              {formatDayWithWeekday(props.closed_from)} –{" "}
              {formatDayWithWeekday(props.closed_to)}
            </Text>{" "}
            택배사 휴무 · 고객센터 휴무
          </Text>
        </HStack>
        <HStack gap="x2_5">
          <Box
            width={20}
            height={20}
            flexShrink={0}
            borderRadius="full"
            borderWidth={1.5}
            borderColor="stroke.brand"
          />
          <Text textStyle="bodySm" color="fg.neutral-muted">
            <Text as="span" textStyle="bodySm" color="fg.neutral" style={BOLD}>
              {formatDayWithWeekday(props.resume_on)}
            </Text>
            부터 접수 순서대로 순차 출고
          </Text>
        </HStack>
      </VStack>
    </VStack>
  );
}
