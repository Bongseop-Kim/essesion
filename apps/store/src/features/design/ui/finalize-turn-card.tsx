import type { GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  Grid,
  HStack,
  Icon,
  ProgressCircle,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ShoppingBagIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { useState } from "react";

import {
  finalizeJobDelayed,
  useCancelFinalizeJob,
  useFinalizeJobQuery,
} from "../model/use-finalize-job";
import { CandidateTile } from "./candidate-grid";
import type { FinalizeTurnPayload } from "./turn-feed";

// 서버(db/src/db/models/design.py)의 TTL 자동 취소 메시지 — 사용자 취소와 문구 구분용
const FINALIZE_STALE_MESSAGE = "finalize 작업 처리 시간이 초과되었습니다";

export type FinalizeTurnCardProps = {
  payload: FinalizeTurnPayload;
  authenticated: boolean;
  previewActive: boolean;
  onPreview: (job: GenerationJobOut) => void;
  onRetry: (job: GenerationJobOut) => Promise<void>;
  onOrder: (job: GenerationJobOut) => void;
};

export function FinalizeTurnCard({
  payload,
  authenticated,
  previewActive,
  onPreview,
  onRetry,
  onOrder,
}: FinalizeTurnCardProps) {
  const jobQuery = useFinalizeJobQuery(payload.job_id, authenticated);
  const cancelMutation = useCancelFinalizeJob();
  const [downloading, setDownloading] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const handleDownload = async (job: GenerationJobOut) => {
    if (downloading || !job.result_url) return;
    setDownloading(true);
    try {
      await downloadResult(job);
      snackbar("실사화를 다운로드했습니다.");
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

  const handleCancel = async (job: GenerationJobOut) => {
    if (cancelMutation.isPending) return;
    try {
      await cancelMutation.mutateAsync(job.id);
      snackbar("실사화를 취소했어요. 사용한 횟수는 복구됐어요.");
    } catch {
      snackbar("취소하지 못했어요. 작업이 이미 끝났을 수 있어요.");
      void jobQuery.refetch();
    }
  };

  if (jobQuery.isPending) {
    return <FinalizeProgress attempts={0} />;
  }

  if (jobQuery.isError) {
    return (
      <ContentPlaceholder
        title="실사화 상태를 확인하지 못했어요"
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
    const cancelButton = (
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        loading={cancelMutation.isPending}
        onClick={() => void handleCancel(job)}
      >
        <Icon svg={<XMarkIcon />} size={18} />
        취소하고 횟수 되돌리기
      </ActionButton>
    );
    return finalizeJobDelayed(job) ? (
      <VStack gap="x3" alignItems="stretch">
        <Callout
          tone="neutral"
          title="실사화가 지연되고 있어요"
          description="나중에 이 세션을 다시 열면 완성 결과를 확인할 수 있어요. 너무 오래 걸리면 자동으로 취소되고 횟수가 복구돼요."
        />
        <HStack gap="x2" wrap>
          <ActionButton
            type="button"
            size="small"
            variant="neutralOutline"
            onClick={() => void jobQuery.refetch()}
          >
            <Icon svg={<ArrowPathIcon />} size={18} />
            상태 다시 확인
          </ActionButton>
          {cancelButton}
        </HStack>
      </VStack>
    ) : (
      <VStack gap="x3" alignItems="stretch">
        <FinalizeProgress attempts={job.attempts} />
        <HStack gap="x2" wrap>
          {cancelButton}
        </HStack>
      </VStack>
    );
  }

  if (job.status === "canceled") {
    const timedOut = job.error_message === FINALIZE_STALE_MESSAGE;
    return (
      <ContentPlaceholder
        title={
          timedOut ? "실사화가 시간 초과로 취소됐어요" : "실사화를 취소했어요"
        }
        description="취소한 실사화는 횟수에 포함되지 않아요. 언제든 다시 시도할 수 있어요."
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
    );
  }

  if (job.status === "failed") {
    // 실패한 실사화는 24시간 쿼터 카운트에서 빠진다 — 별도 경고 없이 재시도만 안내.
    return (
      <ContentPlaceholder
        title="실사화를 만들지 못했어요"
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
    );
  }

  return (
    <VStack gap="x3" alignItems="stretch">
      <Text textStyle="label">실사화가 완성됐어요</Text>
      <Grid columns={{ base: 2, md: 4 }} gap="x3">
        <CandidateTile
          label="완성된 실사화 미리보기"
          imageSrc={job.result_url ?? undefined}
          alt="완성된 실사화 이미지"
          selected={previewActive}
          disabled={!job.result_url}
          onClick={() => onPreview(job)}
        />
      </Grid>
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
        <ProgressCircle size={24} aria-label="실사화 생성 중" />
        <VStack gap="x1" alignItems="stretch">
          <Text textStyle="labelSm">
            {attempts > 1 ? "실사화 재시도 중" : "실사화 생성 중"}
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
