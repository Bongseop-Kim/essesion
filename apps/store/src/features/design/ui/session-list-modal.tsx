import {
  ActionButton,
  Box,
  ContentPlaceholder,
  HStack,
  Icon,
  Modal,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ExclamationTriangleIcon,
  FolderOpenIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { svgTileStyle } from "@/features/design/model/svg-preview";
import { formatDateTime } from "@/shared/lib/format";

const formatDate = (value: string) =>
  formatDateTime(
    value,
    {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    },
    value,
  );

export type DesignSessionSummary = {
  id: string;
  createdAt: string;
  /** 마지막 생성 프롬프트 — 세션 구분용 요약 (프롬프트 턴이 없으면 null) */
  lastPrompt: string | null;
  /** 현재 스텝 디자인 SVG — 목록 썸네일 (생성 전 세션이면 null) */
  previewSvg: string | null;
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
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="내 디자인"
      description="이어서 고칠 디자인을 선택해 주세요."
      size="medium"
      showCloseButton
    >
      {loading ? (
        <SessionListSkeleton />
      ) : error ? (
        <ContentPlaceholder
          icon={<Icon svg={<ExclamationTriangleIcon />} size={32} />}
          title="디자인을 불러오지 못했어요"
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
          title="저장된 디자인이 없어요"
          description="첫 디자인을 만들면 여기에 저장돼요."
        />
      ) : (
        <VStack gap="x3" alignItems="stretch">
          {sessions.map((session) => {
            const selected = session.id === selectedId;
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
                <HStack
                  as="button"
                  type="button"
                  flex={1}
                  minWidth={0}
                  gap="x3"
                  aria-pressed={selected}
                  onClick={() => onSelect(session)}
                  px="x4"
                  py="x4"
                  borderRadius="r3"
                  className="text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                >
                  {session.previewSvg ? (
                    <Box
                      width={56}
                      borderRadius="r2"
                      borderWidth={1}
                      borderColor="stroke.neutral-weak"
                      className="shrink-0"
                      style={svgTileStyle(session.previewSvg)}
                      role="img"
                      aria-label="디자인 미리보기"
                    />
                  ) : null}
                  <VStack gap="x2" minWidth={0} alignItems="stretch" flex={1}>
                    <Text textStyle="labelSm">
                      {formatDate(session.createdAt)}
                    </Text>
                    {session.lastPrompt ? (
                      <Text textStyle="caption" color="fg.neutral" maxLines={2}>
                        “{session.lastPrompt}”
                      </Text>
                    ) : null}
                  </VStack>
                </HStack>
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
    </Modal>
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
          <HStack gap="x3" alignItems="flex-start">
            <Skeleton width={56} height={56} radius="r2" />
            <VStack gap="x2" alignItems="stretch" flex={1}>
              <Skeleton width="55%" height={19} />
              <Skeleton width="80%" height={18} />
            </VStack>
          </HStack>
        </Box>
      ))}
    </VStack>
  );
}
