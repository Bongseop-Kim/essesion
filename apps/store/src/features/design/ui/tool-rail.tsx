import { Box, Flex, Grid, Icon, Modal, Text, VStack } from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  FolderOpenIcon,
  PlusIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useRef } from "react";

const MOBILE_SHEET_EXIT_MS = 300;

export type ToolRailProps = {
  onExport: () => void;
  onFinalize: () => void;
  onSessions: () => void;
  onFinalized: () => void;
  onNewSession: () => void;
  canExport: boolean;
  canFinalize: boolean;
  busy: boolean;
  mobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
};

type RailItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * PC는 캔버스 우측 레일, 모바일은 입력창의 + 버튼이 여는 하단 시트로 표시한다.
 */
export function ToolRail(props: ToolRailProps) {
  const mobileActionTimer = useRef<number | undefined>(undefined);
  const actions: RailItem[] = [
    {
      key: "export",
      label: "내려받기",
      icon: <Icon svg={<ArrowDownTrayIcon />} size={24} />,
      onClick: props.onExport,
      disabled: !props.canExport,
    },
    {
      key: "finalize",
      label: "실사화",
      icon: <Icon svg={<Squares2X2Icon />} size={24} />,
      onClick: props.onFinalize,
      disabled: !props.canFinalize,
    },
  ];
  const tools: RailItem[] = [
    {
      key: "sessions",
      label: "내 디자인",
      icon: <Icon svg={<FolderOpenIcon />} size={24} />,
      onClick: props.onSessions,
    },
    {
      key: "finalized",
      label: "완성본",
      icon: <Icon svg={<BookmarkIcon />} size={24} />,
      onClick: props.onFinalized,
    },
    {
      key: "new",
      label: "새로 시작",
      icon: <Icon svg={<PlusIcon />} size={24} />,
      onClick: props.onNewSession,
      disabled: props.busy,
    },
  ];
  const items = [...actions, ...tools];

  useEffect(() => () => window.clearTimeout(mobileActionTimer.current), []);

  const runMobileAction = (item: RailItem) => {
    props.onMobileOpenChange(false);
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.clearTimeout(mobileActionTimer.current);
    mobileActionTimer.current = window.setTimeout(
      item.onClick,
      reducedMotion ? 0 : MOBILE_SHEET_EXIT_MS,
    );
  };

  return (
    <>
      <Flex
        as="nav"
        aria-label="디자인 도구"
        display={{ base: "none", md: "flex" }}
        alignItems="flex-start"
        gap="x2"
      >
        <RailColumn items={actions} />
        <RailColumn items={tools} />
      </Flex>

      <Box display={{ base: "block", md: "none" }}>
        <Modal
          open={props.mobileOpen}
          onOpenChange={props.onMobileOpenChange}
          title="디자인 도구"
          size="small"
        >
          <Grid as="nav" aria-label="모바일 디자인 도구" columns={4} gap="x2">
            {items.map((item) => {
              const { key, ...button } = item;
              return (
                <RailButton
                  key={key}
                  {...button}
                  onClick={() => runMobileAction(item)}
                />
              );
            })}
          </Grid>
        </Modal>
      </Box>
    </>
  );
}

function RailColumn({ items }: { items: readonly RailItem[] }) {
  return (
    <VStack alignItems="center" gap={{ base: "x2", md: "x3" }}>
      {items.map(({ key, ...item }) => (
        <RailButton key={key} {...item} />
      ))}
    </VStack>
  );
}

function RailButton({
  label,
  icon,
  onClick,
  disabled = false,
}: Omit<RailItem, "key">) {
  return (
    <Flex
      as="button"
      type="button"
      direction="column"
      alignItems="center"
      gap="x1_5"
      width={72}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Flex
        alignItems="center"
        justifyContent="center"
        width={48}
        height={48}
        borderRadius="full"
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        bg="bg.layer-floating"
        boxShadow={disabled ? "none" : "s1"}
        className="text-fg-neutral transition-colors duration-100 ease-standard group-hover:bg-bg-neutral-weak"
      >
        {icon}
      </Flex>
      <Text textStyle="captionSm" color="fg.neutral-muted" align="center">
        {label}
      </Text>
    </Flex>
  );
}
