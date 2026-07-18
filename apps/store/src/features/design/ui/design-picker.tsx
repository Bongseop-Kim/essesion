import type { GenerationJobOut } from "@essesion/api-client";
import { listGenerationJobsOptions } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  FieldButton,
  Flex,
  Float,
  Grid,
  Icon,
  ImageFrame,
  ResponsiveModal,
  Skeleton,
  Text,
  VStack,
} from "@essesion/shared";
import {
  CheckIcon,
  PhotoIcon,
  SparklesIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useAuthGuard } from "@/features/auth";
import { useSession } from "@/shared/store/session";

const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export type DesignPickerProps = {
  selected: GenerationJobOut | null;
  onChange: (selected: GenerationJobOut | null) => void;
  disabled?: boolean;
};

export function DesignPicker({
  selected,
  onChange,
  disabled = false,
}: DesignPickerProps) {
  const [open, setOpen] = useState(false);
  const status = useSession((state) => state.status);
  const { requireAuth } = useAuthGuard();
  const jobsQuery = useQuery({
    ...listGenerationJobsOptions({
      query: { kind: "finalize", status: "succeeded", limit: 100 },
    }),
    enabled: open && status === "authenticated",
  });

  const handleOpen = () => {
    if (!requireAuth({ path: "/custom-order" })) return;
    setOpen(true);
  };

  const toggle = (job: GenerationJobOut) => {
    onChange(selected?.id === job.id ? null : job);
    setOpen(false);
  };

  return (
    <>
      <FieldButton
        label="AI 디자인"
        description="원단 시뮬레이션을 마친 내 디자인을 참고 이미지로 가져올 수 있어요."
        placeholder="내 AI 디자인에서 선택"
        value={selected ? formatDate(selected.created_at) : undefined}
        disabled={disabled || status === "loading"}
        onClick={handleOpen}
      />
      <ResponsiveModal
        open={open}
        onOpenChange={setOpen}
        title="내 AI 디자인"
        description="완성한 디자인 중 1개를 선택할 수 있어요."
        showCloseButton
        footer={
          <Box
            as={ActionButton}
            type="button"
            width="full"
            onClick={() => setOpen(false)}
          >
            닫기
          </Box>
        }
      >
        <VStack gap="x4" alignItems="stretch">
          {jobsQuery.isPending ? (
            <Grid columns={2} gap="x3">
              {Array.from({ length: 4 }, (_, index) => (
                <Skeleton
                  key={index}
                  width="100%"
                  radius="r4"
                  style={{ aspectRatio: 1 }}
                />
              ))}
            </Grid>
          ) : jobsQuery.isError ? (
            <ContentPlaceholder
              title="완성 디자인을 불러오지 못했어요"
              description="잠시 후 다시 시도해 주세요."
              action={
                <ActionButton
                  type="button"
                  size="small"
                  variant="neutralOutline"
                  onClick={() => void jobsQuery.refetch()}
                >
                  다시 시도
                </ActionButton>
              }
            />
          ) : jobsQuery.data.length === 0 ? (
            <ContentPlaceholder
              icon={<Icon svg={<SparklesIcon />} size={32} />}
              title="완성한 AI 디자인이 없어요"
              description="디자인 페이지에서 원단 시뮬레이션을 먼저 완성해 주세요."
            />
          ) : (
            <Grid columns={2} gap="x3" aria-label="완성한 AI 디자인">
              {jobsQuery.data.map((job, index) => {
                const checked = selected?.id === job.id;
                return (
                  <Box
                    as="button"
                    type="button"
                    key={job.id}
                    aria-pressed={checked}
                    aria-label={`완성 디자인 ${index + 1}`}
                    onClick={() => toggle(job)}
                    borderWidth={2}
                    borderColor={
                      checked ? "stroke.brand" : "stroke.neutral-weak"
                    }
                    borderRadius="r3"
                    bg={checked ? "bg.brand-weak" : "bg.layer-default"}
                    p="x1"
                    className="text-left transition-colors duration-100 ease-standard hover:border-stroke-brand focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
                  >
                    <ImageFrame
                      ratio={1}
                      src={job.result_url ?? undefined}
                      alt={`완성한 AI 디자인 ${index + 1}`}
                      fit="cover"
                      borderRadius="r2"
                      fallback={
                        <VStack
                          position="absolute"
                          inset={0}
                          align="center"
                          justify="center"
                          gap="x2"
                          bg="bg.neutral-weak"
                        >
                          <Icon svg={<PhotoIcon />} size={28} />
                          <Text textStyle="captionSm" color="fg.neutral-subtle">
                            미리보기 없음
                          </Text>
                        </VStack>
                      }
                    >
                      {checked ? (
                        <Float placement="top-end" offsetX="x2" offsetY="x2">
                          <Flex
                            align="center"
                            justify="center"
                            width={28}
                            height={28}
                            borderRadius="full"
                            bg="bg.brand-solid"
                            className="text-fg-contrast"
                          >
                            <Icon svg={<CheckIcon />} size={18} />
                          </Flex>
                        </Float>
                      ) : null}
                    </ImageFrame>
                    <Text
                      as="span"
                      textStyle="captionSm"
                      color="fg.neutral-muted"
                      px="x2"
                      py="x2"
                    >
                      {formatDate(job.created_at)}
                    </Text>
                  </Box>
                );
              })}
            </Grid>
          )}
        </VStack>
      </ResponsiveModal>
    </>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "완성 디자인"
    : dateFormatter.format(date);
}
