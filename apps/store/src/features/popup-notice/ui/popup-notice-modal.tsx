import type { PopupNoticeOut } from "@essesion/api-client";
import { getActivePopupOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Badge,
  Box,
  HStack,
  Icon,
  ImageFrame,
  Modal,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";

import { splitBold } from "../model/bold-markup";
import {
  dismissForToday,
  isDismissedToday,
  kstToday,
} from "../model/dismissal";
import { HolidayCalendar } from "./holiday-calendar";
import { BoxGlyph, TruckGlyph } from "./icons";
import { OperationTable } from "./operation-table";

const BOLD = { fontWeight: 700 } as const;
const REGULAR = { fontWeight: 400 } as const;

function BodyText({ text }: { text: string }) {
  return (
    <Text
      as="p"
      textStyle="body"
      color="fg.neutral-muted"
      align="center"
      className="whitespace-pre-line"
    >
      {splitBold(text).map((segment, index) =>
        segment.bold ? (
          <Text
            key={`${index}-${segment.text}`}
            as="strong"
            textStyle="body"
            color="fg.neutral"
            style={BOLD}
          >
            {segment.text}
          </Text>
        ) : (
          <span key={`${index}-${segment.text}`}>{segment.text}</span>
        ),
      )}
    </Text>
  );
}

function PopupHeading({
  popup,
  glyph,
}: {
  popup: PopupNoticeOut;
  glyph?: React.ReactElement;
}) {
  return (
    <VStack gap="x3" alignItems="center">
      <Badge variant="solid" tone="brand" className="tracking-widest">
        {popup.template === "event" ? "EVENT" : "NOTICE"}
      </Badge>
      <Text as="h2" textStyle="title1" align="center">
        {popup.title_emphasis ? (
          <>
            <Text as="span" textStyle="title1" style={REGULAR}>
              {popup.title}{" "}
            </Text>
            {popup.title_emphasis}
          </>
        ) : (
          popup.title
        )}
      </Text>
      {glyph ? <Icon svg={glyph} size={56} color="fg.neutral" /> : null}
      {popup.body ? <BodyText text={popup.body} /> : null}
    </VStack>
  );
}

function PopupBody({ popup }: { popup: PopupNoticeOut }) {
  const { fields } = popup;
  if (fields.template === "holiday") {
    return (
      <VStack gap="x4" alignItems="stretch">
        <PopupHeading popup={popup} glyph={<TruckGlyph />} />
        <HolidayCalendar
          cutoff_on={fields.cutoff_on}
          cutoff_time={fields.cutoff_time}
          closed_from={fields.closed_from}
          closed_to={fields.closed_to}
          resume_on={fields.resume_on}
        />
        {fields.footnote ? (
          <Text
            as="p"
            textStyle="caption"
            color="fg.neutral-subtle"
            align="center"
          >
            {fields.footnote}
          </Text>
        ) : null}
      </VStack>
    );
  }
  if (fields.template === "operation") {
    return (
      <VStack gap="x4" alignItems="stretch">
        <PopupHeading popup={popup} glyph={<BoxGlyph />} />
        <OperationTable rows={fields.rows} />
        {fields.footnote ? (
          <Text
            as="p"
            textStyle="caption"
            color="fg.neutral-subtle"
            align="center"
          >
            {fields.footnote}
          </Text>
        ) : null}
      </VStack>
    );
  }
  return (
    <VStack gap="x4" alignItems="stretch">
      {/* ponytail: 시안은 이미지가 모달 가장자리까지 차지한다. shared Modal의 콘텐츠 여백을 넘기는
          옵션이 없어 여백 안에 라운드로 넣었다 — 전폭이 필요하면 Modal에 inset 슬롯을 추가한다. */}
      <ImageFrame
        ratio={4 / 3}
        borderRadius="r3"
        src={fields.image_url}
        alt=""
      />
      <PopupHeading popup={popup} />
    </VStack>
  );
}

export type PopupNoticeModalProps = {
  /** 코치마크와 겹치는 디자인 페이지처럼 띄우지 않을 화면 */
  disabled?: boolean;
};

/**
 * store 첫 진입 팝업 공지 — 활성 팝업이 있고 오늘 닫은 적 없으면 Modal로 띄운다.
 * PC 중앙 / 모바일 하단 시트는 shared Modal이 처리한다.
 */
export function PopupNoticeModal({ disabled = false }: PopupNoticeModalProps) {
  const navigate = useNavigate();
  const query = useQuery({
    ...getActivePopupOptions(),
    enabled: !disabled,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: () =>
      Date.parse(`${kstToday()}T00:00:00+09:00`) + 86_400_000 - Date.now(),
  });
  const popup =
    query.isError ||
    (query.isFetching && kstToday(new Date(query.dataUpdatedAt)) !== kstToday())
      ? null
      : (query.data ?? null);
  const [closedId, setClosedId] = useState<string | null>(null);

  if (disabled || popup === null) return null;
  const open = closedId !== popup.id && !isDismissedToday(popup.id);
  if (!open) return null;

  const close = () => setClosedId(popup.id);
  const dismissToday = () => {
    dismissForToday(popup.id);
    close();
  };
  const follow = () => {
    close();
    const link = popup.link_url;
    if (!link) return;
    if (link.startsWith("/")) navigate(link);
    else window.open(link, "_blank", "noopener,noreferrer");
  };

  return (
    <Modal
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      aria-label={`${popup.title} ${popup.title_emphasis ?? ""}`.trim()}
      footer={
        <HStack gap="x2">
          <Box
            as={ActionButton}
            type="button"
            variant="neutralWeak"
            size="large"
            width="full"
            onClick={dismissToday}
          >
            오늘 하루 보지 않기
          </Box>
          <Box
            as={ActionButton}
            type="button"
            variant="brandSolid"
            size="large"
            width="full"
            onClick={follow}
          >
            {popup.link_url ? "자세히 보기" : "확인"}
          </Box>
        </HStack>
      }
    >
      <PopupBody popup={popup} />
    </Modal>
  );
}
