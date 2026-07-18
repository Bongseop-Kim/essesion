import {
  ActionButton,
  Badge,
  Box,
  ContentPlaceholder,
  HStack,
  Icon,
  ResponsiveModal,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ChevronRightIcon,
  ExclamationTriangleIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";

const FINALIZE_LIMIT = 10;

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export type DesignSessionSummary = {
  id: string;
  createdAt: string;
  status: string;
  finalizeUsed: number;
  /** 마지막 생성 프롬프트 — 세션 구분용 요약 (프롬프트 턴이 없으면 null) */
  lastPrompt: string | null;
};

export type SessionListModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessions: readonly DesignSessionSummary[];
  onSelect: (session: DesignSessionSummary) => void;
  /** 삭제 확인 플로우 시작 — 확인 다이얼로그는 호출자가 담당한다. */
  onDelete?: (session: DesignSessionSummary) => void;
  selectedId?: string | null;
  loading?: boolean;
  error?: boolean | string | null;
  onRetry?: () => void;
};

export function SessionListModal({
  open,
  onOpenChange,
  sessions,
  onSelect,
  onDelete,
  selectedId,
  loading = false,
  error = null,
  onRetry,
}: SessionListModalProps) {
  return (
    <ResponsiveModal
      open={open}
      onOpenChange={onOpenChange}
      title="내 디자인 세션"
      description="이어서 작업할 세션을 선택해 주세요."
      size="medium"
      showCloseButton
    >
      {loading ? (
        <SessionListSkeleton />
      ) : error ? (
        <ContentPlaceholder
          icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
          title="세션을 불러오지 못했어요"
          description={
            typeof error === "string" ? error : "잠시 후 다시 시도해 주세요."
          }
          action={
            onRetry ? (
              <ActionButton
                type="button"
                variant="neutralWeak"
                size="small"
                onClick={onRetry}
              >
                다시 시도
              </ActionButton>
            ) : undefined
          }
        />
      ) : sessions.length === 0 ? (
        <ContentPlaceholder
          icon={<Icon svg={<FolderOpenIcon />} size={32} />}
          title="저장된 세션이 없어요"
          description="첫 디자인을 생성하면 세션이 여기에 저장돼요."
        />
      ) : (
        <VStack gap="x3" alignItems="stretch">
          {sessions.map((session) => {
            const selected = session.id === selectedId;
            const status = sessionStatus(session.status);
            return (
              <HStack
                key={session.id}
                gap="x1"
                borderWidth={1}
                borderColor={selected ? "stroke.brand" : "stroke.neutral-weak"}
                borderRadius="r3"
                bg={selected ? "bg.brand-weak" : "bg.layer-default"}
                pr={onDelete ? "x2" : undefined}
                className="transition-colors duration-100 ease-standard hover:border-stroke-brand"
              >
                <Box
                  as="button"
                  type="button"
                  flex={1}
                  minWidth={0}
                  aria-pressed={selected}
                  onClick={() => onSelect(session)}
                  px="x4"
                  py="x4"
                  borderRadius="r3"
                  className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                >
                  <HStack justify="space-between" gap="x3">
                    <VStack gap="x2" minWidth={0} alignItems="stretch">
                      <Text textStyle="labelSm">
                        {formatDate(session.createdAt)}
                      </Text>
                      {session.lastPrompt ? (
                        <Text
                          textStyle="caption"
                          color="fg.neutral"
                          maxLines={1}
                        >
                          “{session.lastPrompt}”
                        </Text>
                      ) : null}
                      <HStack gap="x2" wrap>
                        <Badge tone={status.tone}>{status.label}</Badge>
                        <Text textStyle="caption" color="fg.neutral-muted">
                          원단 시뮬레이션 {session.finalizeUsed}/
                          {FINALIZE_LIMIT}
                        </Text>
                      </HStack>
                    </VStack>
                    <Icon
                      svg={<ChevronRightIcon />}
                      size={20}
                      color="fg.neutral-subtle"
                    />
                  </HStack>
                </Box>
                {onDelete ? (
                  <ActionButton
                    type="button"
                    size="small"
                    variant="ghost"
                    aria-label={`${formatDate(session.createdAt)} 세션 삭제`}
                    onClick={() => onDelete(session)}
                  >
                    <Icon svg={<TrashIcon />} size={18} />
                  </ActionButton>
                ) : null}
              </HStack>
            );
          })}
        </VStack>
      )}
    </ResponsiveModal>
  );
}

function SessionListSkeleton() {
  return (
    <VStack
      gap="x3"
      alignItems="stretch"
      aria-busy="true"
      aria-label="디자인 세션 불러오는 중"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <Box
          key={index}
          borderWidth={1}
          borderColor="stroke.neutral-weak"
          borderRadius="r3"
          px="x4"
          py="x4"
        >
          <VStack gap="x2" alignItems="stretch">
            <Skeleton width="55%" height={19} />
            <HStack gap="x2">
              <Skeleton width={48} height={20} radius="full" />
              <Skeleton width="45%" height={18} />
            </HStack>
          </VStack>
        </Box>
      ))}
    </VStack>
  );
}

function sessionStatus(status: string): {
  label: string;
  tone: "neutral" | "brand" | "positive";
} {
  if (status === "active") return { label: "작업 중", tone: "brand" };
  if (status === "finalized") return { label: "완성", tone: "positive" };
  return { label: status, tone: "neutral" };
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateFormatter.format(date);
}
