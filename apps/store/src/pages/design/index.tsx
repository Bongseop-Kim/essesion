import { exportDesign, type GenerationJobOut } from "@essesion/api-client";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  Grid,
  HStack,
  Icon,
  LayoutContent,
  PageBanner,
  snackbar,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  FolderOpenIcon,
  PlusIcon,
  Squares2X2Icon,
  SwatchIcon,
} from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import { parseDesignError } from "@/features/design/model/errors";
import {
  type LocalFinalizeTurn,
  mergeFinalizeTurns,
} from "@/features/design/model/finalize-turns";
import {
  completeDesignOnboarding,
  isDesignOnboardingComplete,
} from "@/features/design/model/onboarding";
import { createOperationEpoch } from "@/features/design/model/operation-epoch";
import {
  clearPendingDesign,
  type DesignPending,
  readPendingDesign,
} from "@/features/design/model/pending";
import {
  designSessionQueryOptions,
  designSessionsQueryOptions,
  designTokenBalanceQueryOptions,
  designTurnsQueryOptions,
  generationJobsQueryOptions,
} from "@/features/design/model/queries";
import {
  type DesignSelection,
  restoreDesignSelection,
  selectionForCandidate,
} from "@/features/design/model/selection";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import {
  useDeleteDesignSession,
  useDeleteFinalizedJob,
} from "@/features/design/model/use-delete";
import {
  type CreateFinalizeJobInput,
  finalizeRetryInput,
  useCreateFinalizeJob,
} from "@/features/design/model/use-finalize-job";
import {
  type GenerateDesignInput,
  StaleDesignOperationError,
  useGenerateDesign,
} from "@/features/design/model/use-generate";
import { useDesignSelection } from "@/features/design/model/use-selection";
import {
  ComposerPanelItem,
  DesignComposer,
} from "@/features/design/ui/composer";
import {
  ExportDialog,
  type ExportDialogValue,
  type ExportDpi,
  type ExportFormat,
} from "@/features/design/ui/export-dialog";
import {
  type FabricWeave,
  FinalizeDialog,
  type FinalizeDialogValue,
  type ProductionMethod,
} from "@/features/design/ui/finalize-dialog";
import { FinalizeTurnCard } from "@/features/design/ui/finalize-turn-card";
import { FinalizedListModal } from "@/features/design/ui/finalized-list-modal";
import { OnboardingDialog } from "@/features/design/ui/onboarding-dialog";
import { PreviewModal } from "@/features/design/ui/preview-modal";
import { PreviewPanel } from "@/features/design/ui/preview-panel";
import {
  type DesignSessionSummary,
  SessionListModal,
} from "@/features/design/ui/session-list-modal";
import type { DesignPreviewMode } from "@/features/design/ui/tie-canvas";
import { type TurnCandidate, TurnFeed } from "@/features/design/ui/turn-feed";
import { useSession } from "@/shared/store/session";

const DESCRIPTION =
  "AI와 함께 반복 가능한 넥타이 패턴을 만들고 원단 시뮬레이션까지 확인하세요.";
const FINALIZE_BUDGET = 10;
// 모달 위 모달 금지 — 목록 모달이 닫히는 모션이 끝난 뒤 확인 다이얼로그를 연다.
const OVERLAY_EXIT_MS = 250;

type DeleteTarget =
  | { kind: "session"; id: string }
  | { kind: "job"; id: string };

export function DesignPage() {
  const navigate = useNavigate();
  const breakpoint = useBreakpoint();
  const compactPreview =
    breakpoint === "base" || breakpoint === "sm" || breakpoint === "md";
  const status = useSession((state) => state.status);
  const authenticated = status === "authenticated";
  const { requireAuth } = useAuthGuard();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [newSessionMode, setNewSessionMode] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [candidateCount, setCandidateCount] = useState(4);
  const [previewMode, setPreviewMode] = useState<DesignPreviewMode>("tie");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [finalizedOpen, setFinalizedOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const deleteFlowTimer = useRef<number | undefined>(undefined);
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !isDesignOnboardingComplete(),
  );
  const [pending, setPending] = useState<DesignPending | null>(() =>
    readPendingDesign(),
  );
  const [selectionOverride, setSelectionOverride] = useState<{
    sessionId: string;
    selection: DesignSelection;
  } | null>(null);
  const [resultPreview, setResultPreview] = useState<{
    jobId: string;
    src: string;
  } | null>(null);
  const [localFinalizeTurns, setLocalFinalizeTurns] = useState<
    LocalFinalizeTurn[]
  >([]);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [productionMethod, setProductionMethod] =
    useState<ProductionMethod>("print");
  const [weave, setWeave] = useState<FabricWeave>("twill-45");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>("png");
  const [exportDpi, setExportDpi] = useState<ExportDpi>(300);
  const [exportWidthMm, setExportWidthMm] = useState("100");
  const [exporting, setExporting] = useState(false);
  const generationEpoch = useRef(createOperationEpoch()).current;
  const selectionEpoch = useRef(createOperationEpoch()).current;
  const generationOperations = useRef(
    new WeakMap<GenerateDesignInput, number>(),
  );

  const sessionsQuery = useQuery(designSessionsQueryOptions(authenticated));
  const sessionQuery = useQuery(
    designSessionQueryOptions({
      sessionId: activeSessionId,
      authenticated,
    }),
  );
  const turnsQuery = useQuery(
    designTurnsQueryOptions({
      sessionId: activeSessionId,
      authenticated,
    }),
  );
  const jobsQuery = useQuery(
    generationJobsQueryOptions({
      filters: activeSessionId
        ? {
            kind: "finalize",
            session_id: activeSessionId,
            limit: 100,
            offset: 0,
          }
        : undefined,
      authenticated: authenticated && !!activeSessionId,
    }),
  );
  const balanceQuery = useQuery(designTokenBalanceQueryOptions(authenticated));
  const finalizedJobsQuery = useQuery(
    generationJobsQueryOptions({
      filters: { kind: "finalize", status: "succeeded", limit: 100, offset: 0 },
      authenticated: authenticated && finalizedOpen,
    }),
  );
  const generateMutation = useGenerateDesign({
    onSessionReady: (sessionId, input) => {
      const operation = generationOperations.current.get(input);
      if (operation === undefined || !generationEpoch.isCurrent(operation))
        return false;
      setActiveSessionId(sessionId);
      setNewSessionMode(false);
      return true;
    },
  });
  const selectionMutation = useDesignSelection();
  const finalizeMutation = useCreateFinalizeJob();
  const deleteSessionMutation = useDeleteDesignSession();
  const deleteJobMutation = useDeleteFinalizedJob();
  const deleting =
    deleteSessionMutation.isPending || deleteJobMutation.isPending;

  useEffect(() => () => window.clearTimeout(deleteFlowTimer.current), []);

  useEffect(() => {
    if (
      authenticated &&
      !activeSessionId &&
      !newSessionMode &&
      sessionsQuery.data?.[0]
    ) {
      setActiveSessionId(sessionsQuery.data[0].id);
    }
  }, [activeSessionId, authenticated, newSessionMode, sessionsQuery.data]);

  const restoredSelection = useMemo(() => {
    if (!sessionQuery.data || !turnsQuery.data) return null;
    return restoreDesignSelection(sessionQuery.data, turnsQuery.data);
  }, [sessionQuery.data, turnsQuery.data]);
  const selection =
    selectionOverride?.sessionId === activeSessionId
      ? selectionOverride.selection
      : restoredSelection;
  const selectedImageSrc = selection?.candidate?.svg
    ? svgToDataUri(selection.candidate.svg)
    : null;
  const previewImageSrc = resultPreview?.src ?? selectedImageSrc;
  const previewAlt = resultPreview ? "완성된 원단 시뮬레이션" : undefined;
  const remainingFinalize = Math.max(
    0,
    FINALIZE_BUDGET - (sessionQuery.data?.finalize_used ?? 0),
  );
  const visibleTurns = useMemo(
    () =>
      mergeFinalizeTurns(
        turnsQuery.data ?? [],
        jobsQuery.data ?? [],
        localFinalizeTurns,
        activeSessionId,
      ),
    [activeSessionId, jobsQuery.data, localFinalizeTurns, turnsQuery.data],
  );
  const generationError =
    generateMutation.error &&
    !(generateMutation.error instanceof StaleDesignOperationError)
      ? parseDesignError(generateMutation.error)
      : null;

  const ensureDesignAuth = () => requireAuth({ path: "/design" });

  const runGeneration = (input: GenerateDesignInput) => {
    const operation = generationEpoch.begin();
    generationOperations.current.set(input, operation);
    return { operation, promise: generateMutation.mutateAsync(input) };
  };

  const invalidateSessionOperations = () => {
    generationEpoch.invalidate();
    selectionEpoch.invalidate();
    generateMutation.reset();
    selectionMutation.reset();
  };

  const generatePrompt = async () => {
    if (!prompt.trim() || !ensureDesignAuth()) return;
    generateMutation.reset();
    try {
      const input: GenerateDesignInput = {
        mode: "prompt",
        sessionId: activeSessionId,
        prompt: prompt.trim(),
        candidateCount,
      };
      const { operation, promise } = runGeneration(input);
      const result = await promise;
      if (!generationEpoch.isCurrent(operation)) return;
      setActiveSessionId(result.sessionId);
      setNewSessionMode(false);
      setSelectionOverride(null);
      setPrompt("");
    } catch {
      // 상주 Callout이 오류 종류에 맞는 다음 행동을 제공한다.
    }
  };

  const generateVariation = async () => {
    if (
      !activeSessionId ||
      !selection?.intent ||
      !ensureDesignAuth() ||
      generateMutation.isPending
    ) {
      return;
    }
    generateMutation.reset();
    try {
      const input: GenerateDesignInput = {
        mode: "variation",
        sessionId: activeSessionId,
        intent: selection.intent,
        seed: randomSeed(),
        candidateCount,
        colorway: selection.colorway,
      };
      await runGeneration(input).promise;
    } catch {
      // 상주 Callout이 오류 종류에 맞는 다음 행동을 제공한다.
    }
  };

  const retryGeneration = async () => {
    const previousInput = generateMutation.variables;
    if (!previousInput || !ensureDesignAuth()) return;
    const retryInput =
      previousInput.mode === "prompt"
        ? {
            ...previousInput,
            sessionId: activeSessionId ?? previousInput.sessionId,
          }
        : previousInput;
    generateMutation.reset();
    try {
      const { operation, promise } = runGeneration(retryInput);
      const result = await promise;
      if (!generationEpoch.isCurrent(operation)) return;
      setActiveSessionId(result.sessionId);
      setNewSessionMode(false);
      if (retryInput.mode === "prompt") {
        setSelectionOverride(null);
        setPrompt("");
      }
    } catch {
      // 같은 입력으로 다시 실패한 경우 Callout을 유지한다.
    }
  };

  const selectCandidate = async (
    candidate: TurnCandidate,
    intents: Record<string, unknown>[],
  ) => {
    if (!activeSessionId || !ensureDesignAuth()) return;
    const sessionId = activeSessionId;
    const next = selectionForCandidate(candidate, intents);
    if (!next) {
      snackbar("선택한 후보 정보를 복원하지 못했습니다.");
      return;
    }
    const operation = selectionEpoch.begin();
    setSelectionOverride({ sessionId, selection: next });
    setResultPreview(null);
    if (compactPreview) setPreviewOpen(true);
    try {
      const result = await selectionMutation.mutateAsync({
        sessionId,
        candidate,
        intents,
      });
      if (selectionEpoch.isCurrent(operation) && result.turnAppendError) {
        snackbar("선택은 저장했지만 이력 기록은 남기지 못했습니다.");
      }
    } catch {
      if (!selectionEpoch.isCurrent(operation)) return;
      setSelectionOverride((current) =>
        current?.sessionId === sessionId &&
        current.selection.candidateId === next.candidateId
          ? null
          : current,
      );
      snackbar("디자인을 선택하지 못했습니다. 다시 시도해 주세요.");
    }
  };

  const openFinalize = () => {
    if (!selection?.intent || !ensureDesignAuth()) return;
    setFinalizeOpen(true);
  };

  const createFinalize = async (
    input: CreateFinalizeJobInput,
    closeDialog: boolean,
  ) => {
    try {
      const result = await finalizeMutation.mutateAsync(input);
      if (result.turnAppendError) {
        setLocalFinalizeTurns((current) => [
          ...current,
          {
            sessionId: input.sessionId,
            type: "finalize",
            job_id: result.job.id,
            production_method: input.request.production_method,
            weave: input.request.weave,
            createdAt: new Date().toISOString(),
          },
        ]);
        snackbar("작업은 시작했지만 이력 기록은 남기지 못했습니다.");
      }
      if (closeDialog) setFinalizeOpen(false);
    } catch (error) {
      const feedback = parseDesignError(error);
      snackbar(feedback.detail ?? feedback.message);
    }
  };

  const submitFinalize = async (value: FinalizeDialogValue) => {
    if (!activeSessionId || !selection?.intent) return;
    await createFinalize(
      {
        sessionId: activeSessionId,
        request: {
          intent: selection.intent,
          colorway_id: selection.colorway,
          production_method: value.productionMethod,
          weave: value.weave,
          dpi: value.dpi,
        },
      },
      true,
    );
  };

  const previewFinalizeResult = (job: GenerationJobOut) => {
    if (!job.result_url) return;
    setResultPreview({ jobId: job.id, src: job.result_url });
    if (compactPreview) setPreviewOpen(true);
  };

  const retryFinalize = async (job: GenerationJobOut) => {
    if (!ensureDesignAuth()) return;
    const input = finalizeRetryInput(job);
    if (!input) {
      snackbar("이전 작업의 설정을 복원하지 못해 재시도할 수 없습니다.");
      return;
    }
    await createFinalize(input, false);
  };

  const submitExport = async (value: ExportDialogValue) => {
    if (!selection?.candidate?.svg || exporting) return;
    setExporting(true);
    try {
      const response = await exportDesign({
        body: {
          session_id: activeSessionId,
          svg: selection.candidate.svg,
          format: value.format,
          dpi: value.dpi,
          width_mm: value.widthMm,
        },
        parseAs: "blob",
        throwOnError: true,
      });
      if (!(response.data instanceof Blob)) {
        throw new Error("내보내기 응답이 파일 형식이 아닙니다.");
      }
      downloadBlob(response.data, `essesion-design.${value.format}`);
      setExportOpen(false);
      snackbar("디자인 파일을 만들었습니다.");
    } catch (error) {
      snackbar(parseDesignError(error).message);
    } finally {
      setExporting(false);
    }
  };

  const openExport = () => {
    if (!selection?.candidate?.svg || !ensureDesignAuth()) return;
    setExportOpen(true);
  };

  const openPendingSession = () => {
    if (!pending || !ensureDesignAuth()) return;
    invalidateSessionOperations();
    setActiveSessionId(pending.sessionId);
    setNewSessionMode(false);
    setResultPreview(null);
    clearPendingDesign();
    setPending(null);
  };

  const startNewSession = () => {
    invalidateSessionOperations();
    setActiveSessionId(null);
    setNewSessionMode(true);
    setSelectionOverride(null);
    setResultPreview(null);
  };

  const chooseSession = (sessionId: string) => {
    invalidateSessionOperations();
    setActiveSessionId(sessionId);
    setNewSessionMode(false);
    setSelectionOverride(null);
    setResultPreview(null);
    setSessionsOpen(false);
  };

  const scheduleAfterOverlayExit = (run: () => void) => {
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.clearTimeout(deleteFlowTimer.current);
    deleteFlowTimer.current = window.setTimeout(
      run,
      reducedMotion ? 0 : OVERLAY_EXIT_MS,
    );
  };

  const requestDeleteSession = (session: DesignSessionSummary) => {
    setSessionsOpen(false);
    scheduleAfterOverlayExit(() =>
      setDeleteTarget({ kind: "session", id: session.id }),
    );
  };

  const requestDeleteJob = (job: GenerationJobOut) => {
    setFinalizedOpen(false);
    scheduleAfterOverlayExit(() =>
      setDeleteTarget({ kind: "job", id: job.id }),
    );
  };

  // 확인 다이얼로그가 닫히면(취소·성공 공통) 원래의 목록 모달로 돌아간다.
  const closeDeleteConfirm = (target: DeleteTarget) => {
    setDeleteTarget(null);
    scheduleAfterOverlayExit(() =>
      target.kind === "session"
        ? setSessionsOpen(true)
        : setFinalizedOpen(true),
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    try {
      if (target.kind === "session") {
        await deleteSessionMutation.mutateAsync(target.id);
        if (activeSessionId === target.id) {
          // 삭제된 세션이 열려 있었다면 초기화 — 목록 갱신 후 최신 세션이 자동 선택된다.
          invalidateSessionOperations();
          setActiveSessionId(null);
          setSelectionOverride(null);
          setResultPreview(null);
        }
        snackbar("세션을 삭제했습니다.");
      } else {
        await deleteJobMutation.mutateAsync(target.id);
        setResultPreview((current) =>
          current?.jobId === target.id ? null : current,
        );
        snackbar("완성본을 삭제했습니다.");
      }
      closeDeleteConfirm(target);
    } catch {
      snackbar(
        target.kind === "session"
          ? "세션을 삭제하지 못했습니다. 다시 시도해 주세요."
          : "완성본을 삭제하지 못했습니다. 다시 시도해 주세요.",
      );
    }
  };

  const actionProps = {
    selected: !!selection?.intent,
    canExport: !!selection?.candidate?.svg,
    generateCost: balanceQuery.data?.generate_cost ?? null,
    remainingFinalize,
    loading: generateMutation.isPending,
    onVariation: () => void generateVariation(),
    onExport: openExport,
    onFinalize: () => openFinalize(),
  };
  const panelActions = <DesignActions {...actionProps} />;
  // 미리보기 모달 위에 다른 다이얼로그를 겹치지 않도록 모달을 닫고 연다.
  const modalActions = (
    <DesignActions
      {...actionProps}
      onExport={() => {
        setPreviewOpen(false);
        openExport();
      }}
      onFinalize={() => {
        setPreviewOpen(false);
        openFinalize();
      }}
    />
  );

  return (
    <>
      <title>AI 넥타이 디자인 | 영선산업</title>
      <meta name="description" content={DESCRIPTION} />
      <meta name="robots" content="noindex, nofollow" />
      <LayoutContent
        density="high"
        height="full"
        minHeight={0}
        display="flex"
        flexDirection="column"
        px={{ base: 0, lg: "x6" }}
        py={{ base: 0, lg: "x5" }}
      >
        {pending ? (
          <PageBanner
            tone="informative"
            title="진행 중이던 생성이 있어요"
            description="세션을 열면 서버에 저장된 결과를 확인할 수 있어요."
            actionLabel="세션 열기"
            onAction={openPendingSession}
          />
        ) : null}

        <Grid
          columns={{ base: 1, lg: 2 }}
          gap={{ base: 0, lg: "x5" }}
          minHeight={0}
          flex={1}
        >
          <Box display={{ base: "none", lg: "block" }} minHeight={0}>
            <PreviewPanel
              imageSrc={previewImageSrc}
              alt={previewAlt}
              mode={previewMode}
              onModeChange={setPreviewMode}
              actions={panelActions}
            />
          </Box>

          <VStack
            minHeight={0}
            height="full"
            alignItems="stretch"
            overflow="hidden"
            borderWidth={{ base: 0, lg: 1 }}
            borderColor="stroke.neutral-weak"
            borderRadius={{ base: 0, lg: "r4" }}
            bg="bg.layer-default"
          >
            <Text as="h1" className="sr-only">
              AI 패턴 디자인
            </Text>

            <Box
              minHeight={0}
              flex={1}
              overflowY="auto"
              className="overscroll-contain"
            >
              <TurnFeed
                turns={visibleTurns}
                selectedCandidateId={selection?.candidateId}
                loading={!!activeSessionId && turnsQuery.isPending}
                generating={generateMutation.isPending}
                error={!!activeSessionId && turnsQuery.isError}
                selectionLoading={selectionMutation.isPending}
                onRetry={() => void turnsQuery.refetch()}
                onSelectCandidate={(candidate, intents) =>
                  void selectCandidate(candidate, intents)
                }
                renderFinalizeTurn={(payload) => (
                  <FinalizeTurnCard
                    payload={payload}
                    authenticated={authenticated}
                    previewActive={resultPreview?.jobId === payload.job_id}
                    onPreview={previewFinalizeResult}
                    onRetry={retryFinalize}
                    onOrder={(job) =>
                      navigate("/custom-order", {
                        state: { designJobs: [job] },
                      })
                    }
                  />
                )}
              />
            </Box>

            {generationError ? (
              <Box px="x4" py="x3">
                <GenerationErrorCallout
                  error={generationError}
                  onRetry={() => void retryGeneration()}
                  onPurchase={() => navigate("/token/purchase")}
                />
              </Box>
            ) : null}
            <Box
              px="x4"
              py="x4"
              bg="bg.layer-default"
              className="border-t border-stroke-neutral-weak"
            >
              <DesignComposer
                prompt={prompt}
                candidateCount={candidateCount}
                onPromptChange={setPrompt}
                onCandidateCountChange={setCandidateCount}
                onSubmit={() => void generatePrompt()}
                balance={balanceQuery.data?.total ?? null}
                generateCost={balanceQuery.data?.generate_cost ?? null}
                onPurchaseTokens={() => navigate("/token/purchase")}
                loading={generateMutation.isPending}
                disabled={status === "loading"}
                sessionActions={
                  <>
                    <ComposerPanelItem
                      icon={<Icon svg={<FolderOpenIcon />} size={24} />}
                      label="내 세션"
                      onClick={() => setSessionsOpen(true)}
                      disabled={!authenticated}
                    />
                    <ComposerPanelItem
                      icon={<Icon svg={<SwatchIcon />} size={24} />}
                      label="내 완성본"
                      onClick={() => setFinalizedOpen(true)}
                      disabled={!authenticated}
                    />
                    <ComposerPanelItem
                      icon={<Icon svg={<PlusIcon />} size={24} />}
                      label="새로 만들기"
                      onClick={startNewSession}
                    />
                  </>
                }
              />
            </Box>
          </VStack>
        </Grid>
      </LayoutContent>

      <PreviewModal
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        imageSrc={previewImageSrc}
        alt={previewAlt}
        mode={previewMode}
        onModeChange={setPreviewMode}
        actions={modalActions}
      />
      <FinalizeDialog
        open={finalizeOpen}
        onOpenChange={setFinalizeOpen}
        productionMethod={productionMethod}
        weave={weave}
        dpi={300}
        onProductionMethodChange={(method) => {
          setProductionMethod(method);
          if (
            method === "print" &&
            weave !== "twill-0" &&
            weave !== "twill-45"
          ) {
            setWeave("twill-45");
          }
        }}
        onWeaveChange={setWeave}
        onSubmit={(value) => void submitFinalize(value)}
        remaining={remainingFinalize}
        loading={finalizeMutation.isPending}
        disabled={!selection?.intent}
      />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        format={exportFormat}
        dpi={exportDpi}
        widthMm={exportWidthMm}
        onFormatChange={setExportFormat}
        onDpiChange={setExportDpi}
        onWidthMmChange={setExportWidthMm}
        onSubmit={(value) => void submitExport(value)}
        loading={exporting}
        disabled={!selection?.candidate?.svg}
      />
      <SessionListModal
        open={sessionsOpen}
        onOpenChange={setSessionsOpen}
        sessions={(sessionsQuery.data ?? []).map((session) => ({
          id: session.id,
          createdAt: session.created_at,
          status: session.status,
          finalizeUsed: session.finalize_used,
          lastPrompt: session.last_prompt ?? null,
        }))}
        selectedId={activeSessionId}
        loading={sessionsQuery.isPending}
        error={sessionsQuery.isError}
        onRetry={() => void sessionsQuery.refetch()}
        onSelect={(session) => chooseSession(session.id)}
        onDelete={requestDeleteSession}
      />
      <FinalizedListModal
        open={finalizedOpen}
        onOpenChange={setFinalizedOpen}
        jobs={finalizedJobsQuery.data ?? []}
        loading={finalizedJobsQuery.isPending}
        error={finalizedJobsQuery.isError}
        onRetry={() => void finalizedJobsQuery.refetch()}
        onOrder={(job) =>
          navigate("/custom-order", { state: { designJobs: [job] } })
        }
        onDelete={requestDeleteJob}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deleteTarget) closeDeleteConfirm(deleteTarget);
        }}
        title={
          deleteTarget?.kind === "session"
            ? "세션을 삭제할까요?"
            : "완성본을 삭제할까요?"
        }
        description={
          deleteTarget?.kind === "session"
            ? "대화 이력이 함께 삭제돼요. 완성한 원단 시뮬레이션 결과는 내 완성본에 남아요."
            : "삭제한 완성본은 복구할 수 없어요. 이미 접수한 주문에는 영향이 없어요."
        }
        primaryActionProps={{
          children: "삭제",
          variant: "criticalSolid",
          loading: deleting,
          onClick: (event) => {
            // 요청 완료 전 닫히지 않도록 기본 닫힘을 막는다 — 성공 시 confirmDelete가 닫는다.
            event.preventDefault();
            void confirmDelete();
          },
        }}
        secondaryActionProps={{
          children: "취소",
          disabled: deleting,
        }}
      />
      <OnboardingDialog
        open={onboardingOpen}
        onOpenChange={setOnboardingOpen}
        onComplete={() => {
          completeDesignOnboarding();
          setOnboardingOpen(false);
        }}
      />
    </>
  );
}

function DesignActions({
  selected,
  canExport,
  generateCost,
  remainingFinalize,
  loading,
  onVariation,
  onExport,
  onFinalize,
}: {
  selected: boolean;
  canExport: boolean;
  generateCost: number | null;
  remainingFinalize: number;
  loading: boolean;
  onVariation: () => void;
  onExport: () => void;
  onFinalize: () => void;
}) {
  return (
    <HStack gap="x2" wrap>
      <ActionButton
        type="button"
        size="small"
        variant="neutralWeak"
        disabled={!selected || loading}
        onClick={onVariation}
      >
        <Icon svg={<ArrowPathIcon />} size={18} />
        배리에이션 {generateCost == null ? "" : `${generateCost}토큰`}
      </ActionButton>
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        disabled={!canExport}
        onClick={onExport}
      >
        <Icon svg={<ArrowDownTrayIcon />} size={18} />
        내보내기
      </ActionButton>
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        disabled={!selected || remainingFinalize <= 0}
        onClick={onFinalize}
      >
        <Icon svg={<Squares2X2Icon />} size={18} />
        원단 시뮬레이션 {remainingFinalize}회
      </ActionButton>
    </HStack>
  );
}

function GenerationErrorCallout({
  error,
  onRetry,
  onPurchase,
}: {
  error: ReturnType<typeof parseDesignError>;
  onRetry: () => void;
  onPurchase: () => void;
}) {
  if (error.kind === "insufficient_tokens") {
    return (
      <Callout
        tone="warning"
        title="토큰이 부족해요"
        description="토큰을 충전한 뒤 다시 생성해 주세요."
        onClick={onPurchase}
      >
        <Text as="span" textStyle="labelSm">
          토큰 충전하기
        </Text>
      </Callout>
    );
  }
  if (error.kind === "refund_pending") {
    return (
      <Callout
        tone="warning"
        title="환불 심사 중에는 생성할 수 없어요"
        description="심사가 끝난 뒤 다시 이용해 주세요."
      />
    );
  }
  if (error.kind === "worker_rejected") {
    return (
      <Callout
        tone="warning"
        title="요청을 이해하지 못했어요"
        description={error.message}
      >
        <Text as="span" textStyle="captionSm">
          요청 내용을 바꿔 다시 생성해 주세요.
        </Text>
      </Callout>
    );
  }
  return (
    <Callout
      tone="critical"
      title="디자인을 생성하지 못했어요"
      description={error.message}
      onClick={onRetry}
    >
      <Text as="span" textStyle="labelSm">
        같은 요청 다시 시도
      </Text>
    </Callout>
  );
}

function randomSeed() {
  if (globalThis.crypto?.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
  }
  return Date.now() % 4_294_967_296;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
