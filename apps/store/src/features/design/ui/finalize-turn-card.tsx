import type { GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  HStack,
  Icon,
  ImageFrame,
  ProgressCircle,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ShoppingBagIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";

import {
  finalizeJobPollInterval,
  useFinalizeJobQuery,
} from "../model/use-finalize-job";
import type { FinalizeTurnPayload } from "./turn-feed";

export type FinalizeTurnCardProps = {
  payload: FinalizeTurnPayload;
  authenticated: boolean;
  onRetry: (job: GenerationJobOut) => Promise<void>;
  onOrder: (job: GenerationJobOut) => void;
};

export function FinalizeTurnCard({
  payload,
  authenticated,
  onRetry,
  onOrder,
}: FinalizeTurnCardProps) {
  const jobQuery = useFinalizeJobQuery(payload.job_id, authenticated);
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handleDownload = async (job: GenerationJobOut) => {
    if (downloading || !job.result_url) return;
    setDownloading(true);
    try {
      await downloadResult(job);
      snackbar("원단 시뮬레이션을 다운로드했습니다.");
    } catch {
      snackbar("파일을 다운로드하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setDownloading(false);
    }
  };

  const handleRetry = async (job: GenerationJobOut) => {
    if (retrying) return;
    setRetrying(true);
    try {
      await onRetry(job);
    } finally {
      setRetrying(false);
    }
  };

  if (jobQuery.isPending) {
    return <FinalizeProgress attempts={0} />;
  }

  if (jobQuery.isError) {
    return (
      <ContentPlaceholder
        title="원단 시뮬레이션 상태를 확인하지 못했어요"
        description="작업은 서버에서 계속될 수 있어요. 잠시 후 다시 확인해 주세요."
        action={
          <ActionButton
            type="button"
            size="small"
            variant="neutralOutline"
            onClick={() => void jobQuery.refetch()}
          >
            <Icon svg={<ArrowPathIcon />} size={18} />
            상태 다시 확인
          </ActionButton>
        }
      />
    );
  }

  const job = jobQuery.data;
  if (job.status === "queued" || job.status === "processing") {
    const delayed = finalizeJobPollInterval(job) === false;
    return delayed ? (
      <Callout
        tone="neutral"
        title="원단 시뮬레이션이 지연되고 있어요"
        description="나중에 이 세션을 다시 열면 완성 결과를 확인할 수 있어요."
        onClick={() => void jobQuery.refetch()}
      />
    ) : (
      <FinalizeProgress attempts={job.attempts} />
    );
  }

  if (job.status === "failed") {
    return (
      <VStack gap="x3" alignItems="stretch">
        <ContentPlaceholder
          title="원단 시뮬레이션을 만들지 못했어요"
          description={job.error_message ?? "잠시 후 다시 시도해 주세요."}
          action={
            <ActionButton
              type="button"
              size="small"
              variant="neutralOutline"
              loading={retrying}
              onClick={() => void handleRetry(job)}
            >
              <Icon svg={<ArrowPathIcon />} size={18} />
              다시 시도
            </ActionButton>
          }
        />
        <Callout
          tone="warning"
          title="재시도하면 횟수를 한 번 더 사용해요"
          description="실패한 시뮬레이션 횟수는 자동으로 복구되지 않아요."
        />
      </VStack>
    );
  }

  return (
    <VStack gap="x3" alignItems="stretch">
      <Text textStyle="label">원단 시뮬레이션이 완성됐어요</Text>
      <ImageFrame
        ratio={1}
        src={job.result_url ?? undefined}
        alt="완성된 원단 시뮬레이션"
        fit="cover"
        borderRadius="r3"
        stroke
      />
      <HStack gap="x2" wrap>
        <ActionButton
          type="button"
          size="small"
          variant="neutralOutline"
          disabled={!job.result_url}
          loading={downloading}
          onClick={() => void handleDownload(job)}
        >
          <Icon svg={<ArrowDownTrayIcon />} size={18} />
          다운로드
        </ActionButton>
        <ActionButton type="button" size="small" onClick={() => onOrder(job)}>
          <Icon svg={<ShoppingBagIcon />} size={18} />이 디자인으로 주문 제작
        </ActionButton>
      </HStack>
    </VStack>
  );
}

function FinalizeProgress({ attempts }: { attempts: number }) {
  return (
    <Box
      borderWidth={1}
      borderColor="stroke.neutral-weak"
      borderRadius="r3"
      bg="bg.neutral-weak"
      px="x4"
      py="x5"
    >
      <HStack gap="x3" align="flex-start">
        <ProgressCircle size={24} aria-label="원단 시뮬레이션 생성 중" />
        <VStack gap="x1" alignItems="stretch">
          <Text textStyle="labelSm">
            {attempts > 1
              ? "원단 시뮬레이션 재시도 중"
              : "원단 시뮬레이션 생성 중"}
          </Text>
          <Text textStyle="caption" color="fg.neutral-muted">
            보통 수십 초가 걸려요. 창을 닫아도 작업은 계속돼요.
          </Text>
        </VStack>
      </HStack>
    </Box>
  );
}

async function downloadResult(job: GenerationJobOut) {
  if (!job.result_url) return;
  const response = await fetch(job.result_url);
  if (!response.ok) {
    throw new Error(`result download failed: ${response.status}`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `essesion-fabric-${job.id}.png`;
  anchor.click();
  globalThis.setTimeout(() => URL.revokeObjectURL(url), 0);
}
