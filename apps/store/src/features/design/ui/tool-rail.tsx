import { Flex, Icon, Text, VStack } from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  BookmarkIcon,
  FolderOpenIcon,
  PlusIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import type { ReactNode } from "react";

export type ToolRailProps = {
  onExport: () => void;
  onFinalize: () => void;
  onSessions: () => void;
  onFinalized: () => void;
  onNewSession: () => void;
  canExport: boolean;
  canFinalize: boolean;
  authenticated: boolean;
  busy: boolean;
};

type RailItem = {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

/**
 * 캔버스 우측 아이콘 레일. PC는 2열(왼쪽=현재 디자인으로 하는 일, 오른쪽=다음 요청 도구)
 * + 라벨, 모바일은 라벨 없이 아이콘 1열이다.
 */
export function ToolRail(props: ToolRailProps) {
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
      disabled: !props.authenticated,
    },
    {
      key: "finalized",
      label: "완성본",
      icon: <Icon svg={<BookmarkIcon />} size={24} />,
      onClick: props.onFinalized,
      disabled: !props.authenticated,
    },
    {
      key: "new",
      label: "새로 시작",
      icon: <Icon svg={<PlusIcon />} size={24} />,
      onClick: props.onNewSession,
      disabled: props.busy,
    },
  ];

  return (
    <Flex
      as="nav"
      aria-label="디자인 도구"
      direction={{ base: "column", md: "row" }}
      alignItems="flex-start"
      gap="x2"
    >
      <RailColumn items={actions} />
      <RailColumn items={tools} />
    </Flex>
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
      width={{ base: 40, md: 72 }}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <Flex
        alignItems="center"
        justifyContent="center"
        width={{ base: 40, md: 48 }}
        height={{ base: 40, md: 48 }}
        borderRadius="full"
        borderWidth={1}
        borderColor="stroke.neutral-weak"
        bg="bg.layer-floating"
        boxShadow={disabled ? "none" : "s1"}
        className="text-fg-neutral transition-colors duration-100 ease-standard group-hover:bg-bg-neutral-weak"
      >
        {icon}
      </Flex>
      <Text
        textStyle="captionSm"
        color="fg.neutral-muted"
        align="center"
        display={{ base: "none", md: "block" }}
      >
        {label}
      </Text>
    </Flex>
  );
}
