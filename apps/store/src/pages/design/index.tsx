import {
  deleteUserMotif,
  exportDesign,
  type GenerationJobOut,
  type UserMotifOut,
} from "@essesion/api-client";
import {
  listUserMotifsOptions,
  listUserMotifsQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  AlertDialog,
  Box,
  Callout,
  Grid,
  HStack,
  Icon,
  LayoutContent,
  MenuItem,
  PageBanner,
  snackbar,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  EyeIcon,
  FolderOpenIcon,
  PlusIcon,
  Squares2X2Icon,
  SwatchIcon,
} from "@heroicons/react/24/outline";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import {
  importDesignMotif,
  MAX_DESIGN_MOTIFS,
  MAX_DESIGN_PHOTOS,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
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
  finalizedJobsInfiniteQueryOptions,
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
  type ComposerAttachment,
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
import { MotifLibraryModal } from "@/features/design/ui/motif-library-modal";
import { OnboardingDialog } from "@/features/design/ui/onboarding-dialog";
import { PreviewModal } from "@/features/design/ui/preview-modal";
import { PreviewPanel } from "@/features/design/ui/preview-panel";
import {
  type DesignSessionSummary,
  SessionListModal,
} from "@/features/design/ui/session-list-modal";
import type { DesignPreviewMode } from "@/features/design/ui/tie-canvas";
import { type TurnCandidate, TurnFeed } from "@/features/design/ui/turn-feed";
import { validateImageFile } from "@/shared/lib/upload";
import { useSession } from "@/shared/store/session";

const DESCRIPTION =
  "AI와 함께 반복 가능한 넥타이 패턴을 만들고 실사화까지 확인하세요.";
// 모달 위 모달 금지 — 목록 모달이 닫히는 모션이 끝난 뒤 확인 다이얼로그를 연다.
const OVERLAY_EXIT_MS = 250;

type DeleteTarget =
  | { kind: "session"; id: string }
  | { kind: "job"; id: string }
  | { kind: "motif"; id: string; name: string };

type PendingPhoto = {
  id: string;
  file: File;
  previewUrl: string;
  uploadId?: string;
};

export function DesignPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  const [motifsOpen, setMotifsOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const photosRef = useRef<PendingPhoto[]>([]);
  photosRef.current = photos;
  const [selectedMotifs, setSelectedMotifs] = useState<UserMotifOut[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [motifDeleting, setMotifDeleting] = useState(false);
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
  const finalizedJobsQuery = useInfiniteQuery(
    finalizedJobsInfiniteQueryOptions(authenticated && finalizedOpen),
  );
  const motifsQuery = useQuery({
    ...listUserMotifsOptions({ query: { limit: 100, offset: 0 } }),
    enabled: authenticated && motifsOpen,
  });
  const finalizedJobs = finalizedJobsQuery.data?.pages.flat() ?? [];
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
    deleteSessionMutation.isPending ||
    deleteJobMutation.isPending ||
    motifDeleting;

  useEffect(
    () => () => {
      window.clearTimeout(deleteFlowTimer.current);
      for (const photo of photosRef.current)
        URL.revokeObjectURL(photo.previewUrl);
    },
    [],
  );

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
  const previewAlt = resultPreview ? "완성된 실사화 이미지" : undefined;
  // 계정당 24시간 쿼터 — 단건 세션 GET에서만 내려온다. null(미로드·설정 부재)이면
  // 막지 않는다: 서버 409가 최종 방어선이고 스낵바로 안내된다.
  const finalizeQuota = sessionQuery.data?.finalize_quota ?? null;
  const finalizeExhausted =
    finalizeQuota !== null && finalizeQuota.remaining <= 0;
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

  const composerAttachments = useMemo<ComposerAttachment[]>(
    () => [
      ...photos.map((photo) => ({
        id: photo.id,
        kind: "photo" as const,
        name: photo.file.name,
        previewSrc: photo.previewUrl,
      })),
      ...selectedMotifs.map((motif) => ({
        id: motif.id,
        kind: "svg" as const,
        name: motif.name,
        previewSrc: svgToDataUri(motif.preview_svg),
      })),
    ],
    [photos, selectedMotifs],
  );

  const clearComposerAttachments = () => {
    for (const photo of photosRef.current)
      URL.revokeObjectURL(photo.previewUrl);
    photosRef.current = [];
    setPhotos([]);
    setSelectedMotifs([]);
  };

  const removeComposerAttachment = (id: string) => {
    const photo = photosRef.current.find((item) => item.id === id);
    if (photo) URL.revokeObjectURL(photo.previewUrl);
    setPhotos((current) => current.filter((item) => item.id !== id));
    setSelectedMotifs((current) => current.filter((item) => item.id !== id));
  };

  const addPhotoFiles = (files: File[]) => {
    if (!ensureDesignAuth()) return;
    const remaining = MAX_DESIGN_PHOTOS - photosRef.current.length;
    if (remaining <= 0) {
      snackbar(`참고 사진은 최대 ${MAX_DESIGN_PHOTOS}장까지 첨부할 수 있어요.`);
      return;
    }
    if (files.length > remaining) {
      snackbar(`참고 사진은 최대 ${MAX_DESIGN_PHOTOS}장까지 첨부할 수 있어요.`);
    }
    const accepted: PendingPhoto[] = [];
    for (const file of files.slice(0, remaining)) {
      try {
        validateImageFile(file, "사진은 장당 10MB 이하로 선택해 주세요.");
        accepted.push({
          id: globalThis.crypto.randomUUID(),
          file,
          previewUrl: URL.createObjectURL(file),
        });
      } catch (error) {
        snackbar(
          error instanceof Error ? error.message : "사진을 확인해 주세요.",
        );
      }
    }
    if (accepted.length > 0) {
      setPhotos((current) => [...current, ...accepted]);
    }
  };

  const addSvgFiles = async (files: File[]) => {
    if (!ensureDesignAuth() || attachmentsBusy) return;
    const remaining = MAX_DESIGN_MOTIFS - selectedMotifs.length;
    if (remaining <= 0) {
      snackbar(`모티프는 최대 ${MAX_DESIGN_MOTIFS}개까지 사용할 수 있어요.`);
      return;
    }
    if (files.length > remaining) {
      snackbar(`모티프는 최대 ${MAX_DESIGN_MOTIFS}개까지 사용할 수 있어요.`);
    }
    setAttachmentsBusy(true);
    try {
      for (const file of files.slice(0, remaining)) {
        try {
          const motif = await importDesignMotif(file);
          setSelectedMotifs((current) =>
            current.some((item) => item.id === motif.id)
              ? current
              : [...current, motif].slice(0, MAX_DESIGN_MOTIFS),
          );
        } catch (error) {
          snackbar(
            error instanceof Error
              ? error.message
              : `${file.name}을 모티프로 가져오지 못했습니다.`,
          );
        }
      }
      await queryClient.invalidateQueries({
        queryKey: listUserMotifsQueryKey(),
      });
    } finally {
      setAttachmentsBusy(false);
    }
  };

  const toggleMotif = (motif: UserMotifOut) => {
    setSelectedMotifs((current) => {
      if (current.some((item) => item.id === motif.id)) {
        return current.filter((item) => item.id !== motif.id);
      }
      if (current.length >= MAX_DESIGN_MOTIFS) {
        snackbar(`모티프는 최대 ${MAX_DESIGN_MOTIFS}개까지 사용할 수 있어요.`);
        return current;
      }
      return [...current, motif];
    });
  };

  const ensureUploadedPhotos = async () => {
    const uploadIds: string[] = [];
    for (const photo of photosRef.current) {
      const uploadId = photo.uploadId ?? (await uploadDesignPhoto(photo.file));
      uploadIds.push(uploadId);
      if (!photo.uploadId) {
        setPhotos((current) =>
          current.map((item) =>
            item.id === photo.id ? { ...item, uploadId } : item,
          ),
        );
        photo.uploadId = uploadId;
      }
    }
    return uploadIds;
  };

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
    if (
      (!prompt.trim() && selectedMotifs.length === 0) ||
      !ensureDesignAuth() ||
      attachmentsBusy
    ) {
      return;
    }
    generateMutation.reset();
    let generationStarted = false;
    setAttachmentsBusy(true);
    try {
      const referenceImageUploadIds = await ensureUploadedPhotos();
      const input: GenerateDesignInput = {
        mode: "prompt",
        sessionId: activeSessionId,
        prompt: prompt.trim(),
        candidateCount,
        referenceImageUploadIds,
        userMotifIds: selectedMotifs.map((motif) => motif.id),
      };
      generationStarted = true;
      const { operation, promise } = runGeneration(input);
      const result = await promise;
      if (!generationEpoch.isCurrent(operation)) return;
      setActiveSessionId(result.sessionId);
      setNewSessionMode(false);
      setSelectionOverride(null);
      setPrompt("");
      clearComposerAttachments();
    } catch (error) {
      // 상주 Callout이 오류 종류에 맞는 다음 행동을 제공한다.
      if (!generationStarted) {
        snackbar(
          error instanceof Error
            ? error.message
            : "첨부 파일을 업로드하지 못했습니다.",
        );
      }
    } finally {
      setAttachmentsBusy(false);
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
        clearComposerAttachments();
      }
    } catch {
      // 같은 입력으로 다시 실패한 경우 Callout을 유지한다.
    }
  };

  const selectCandidate = async (
    candidate: TurnCandidate,
    intents: Record<string, unknown>[],
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    // guard 실패는 전부 첫 await 이전(동기)이라 preventDefault로 타일 메뉴 오픈까지 막는다.
    if (!activeSessionId || !ensureDesignAuth()) {
      event?.preventDefault();
      return;
    }
    const sessionId = activeSessionId;
    const next = selectionForCandidate(candidate, intents);
    if (!next) {
      event?.preventDefault();
      snackbar("선택한 후보 정보를 복원하지 못했습니다.");
      return;
    }
    // 이미 선택된 후보 재탭 — 저장할 변화가 없다(메뉴 오픈은 그대로 진행).
    if (selection?.candidateId === next.candidateId) return;
    const operation = selectionEpoch.begin();
    setSelectionOverride({ sessionId, selection: next });
    setResultPreview(null);
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

  // 결과 타일 탭: 프리뷰 대상 스테이징만 — 데스크톱은 좌측 패널에 즉시 반영,
  // 모바일은 앵커 메뉴가 열린다(시트는 메뉴의 미리보기로만).
  const stageFinalizeResult = (job: GenerationJobOut) => {
    if (!job.result_url) return;
    setResultPreview({ jobId: job.id, src: job.result_url });
  };

  const openFinalizeResultPreview = (job: GenerationJobOut) => {
    if (!job.result_url) return;
    setResultPreview({ jobId: job.id, src: job.result_url });
    setPreviewOpen(true);
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
        throw new Error("내려받기 응답이 파일 형식이 아닙니다.");
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
    clearComposerAttachments();
    setActiveSessionId(pending.sessionId);
    setNewSessionMode(false);
    setResultPreview(null);
    clearPendingDesign();
    setPending(null);
  };

  const startNewSession = () => {
    invalidateSessionOperations();
    clearComposerAttachments();
    setActiveSessionId(null);
    setNewSessionMode(true);
    setSelectionOverride(null);
    setResultPreview(null);
    setPrompt("");
  };

  const chooseSession = (sessionId: string) => {
    invalidateSessionOperations();
    clearComposerAttachments();
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

  const requestDeleteMotif = (motif: UserMotifOut) => {
    setMotifsOpen(false);
    scheduleAfterOverlayExit(() =>
      setDeleteTarget({ kind: "motif", id: motif.id, name: motif.name }),
    );
  };

  // 확인 다이얼로그가 닫히면(취소·성공 공통) 원래의 목록 모달로 돌아간다.
  const closeDeleteConfirm = (target: DeleteTarget) => {
    setDeleteTarget(null);
    scheduleAfterOverlayExit(() => {
      if (target.kind === "session") setSessionsOpen(true);
      else if (target.kind === "job") setFinalizedOpen(true);
      else setMotifsOpen(true);
    });
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
      } else if (target.kind === "job") {
        await deleteJobMutation.mutateAsync(target.id);
        setResultPreview((current) =>
          current?.jobId === target.id ? null : current,
        );
        snackbar("완성본을 삭제했습니다.");
      } else {
        setMotifDeleting(true);
        await deleteUserMotif({
          path: { user_motif_id: target.id },
          throwOnError: true,
        });
        setSelectedMotifs((current) =>
          current.filter((motif) => motif.id !== target.id),
        );
        await queryClient.invalidateQueries({
          queryKey: listUserMotifsQueryKey(),
        });
        snackbar("모티프를 삭제했습니다.");
      }
      closeDeleteConfirm(target);
    } catch {
      snackbar(
        target.kind === "session"
          ? "세션을 삭제하지 못했습니다. 다시 시도해 주세요."
          : target.kind === "job"
            ? "완성본을 삭제하지 못했습니다. 다시 시도해 주세요."
            : "모티프를 삭제하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setMotifDeleting(false);
    }
  };

  const actionProps = {
    selected: !!selection?.intent,
    canExport: !!selection?.candidate?.svg,
    finalizeExhausted,
    loading: generateMutation.isPending,
    onVariation: () => void generateVariation(),
    onExport: openExport,
    onFinalize: () => openFinalize(),
  };
  const panelActions = <DesignActions {...actionProps} />;
  // 모바일: 타일 탭 시 앵커 메뉴로 노출되는 항목들 — 핸들러가 전부 페이지
  // selection 기반이라 모든 타일이 같은 항목을 공유한다.
  const candidateMenu = (
    <>
      <MenuItem
        label="미리보기"
        prefixIcon={<Icon svg={<EyeIcon />} size={18} />}
        onClick={() => setPreviewOpen(true)}
      />
      <MenuItem
        label="내려받기"
        prefixIcon={<Icon svg={<ArrowDownTrayIcon />} size={18} />}
        disabled={!selection?.candidate?.svg}
        onClick={openExport}
      />
      <MenuItem
        label="다시만들기"
        prefixIcon={<Icon svg={<ArrowPathIcon />} size={18} />}
        disabled={!selection?.intent || generateMutation.isPending}
        onClick={() => void generateVariation()}
      />
      <MenuItem
        label="실사화하기"
        prefixIcon={<Icon svg={<Squares2X2Icon />} size={18} />}
        disabled={!selection?.intent || finalizeExhausted}
        onClick={() => openFinalize()}
      />
    </>
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
                onRetry={() => void turnsQuery.refetch()}
                onSelectCandidate={(candidate, intents, event) =>
                  void selectCandidate(candidate, intents, event)
                }
                candidateMenu={compactPreview ? candidateMenu : undefined}
                renderFinalizeTurn={(payload) => (
                  <FinalizeTurnCard
                    payload={payload}
                    authenticated={authenticated}
                    previewActive={resultPreview?.jobId === payload.job_id}
                    anchorMenu={compactPreview}
                    onPreview={stageFinalizeResult}
                    onOpenPreview={openFinalizeResultPreview}
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
                onPhotoFilesSelect={addPhotoFiles}
                onSvgFilesSelect={(files) => void addSvgFiles(files)}
                onOpenMotifLibrary={() => {
                  if (ensureDesignAuth()) setMotifsOpen(true);
                }}
                attachments={composerAttachments}
                onRemoveAttachment={removeComposerAttachment}
                canSubmitWithoutPrompt={selectedMotifs.length > 0}
                balance={balanceQuery.data?.total ?? null}
                generateCost={balanceQuery.data?.generate_cost ?? null}
                onPurchaseTokens={() => navigate("/token/purchase")}
                loading={generateMutation.isPending || attachmentsBusy}
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
        remaining={finalizeQuota?.remaining ?? null}
        resetAt={finalizeQuota?.reset_at ?? null}
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
        jobs={finalizedJobs}
        loading={finalizedJobsQuery.isPending}
        error={finalizedJobsQuery.isError && finalizedJobs.length === 0}
        onRetry={() => void finalizedJobsQuery.refetch()}
        hasMore={finalizedJobsQuery.hasNextPage}
        loadingMore={finalizedJobsQuery.isFetchingNextPage}
        loadMoreError={finalizedJobsQuery.isFetchNextPageError}
        onLoadMore={() => void finalizedJobsQuery.fetchNextPage()}
        onOrder={(job) =>
          navigate("/custom-order", { state: { designJobs: [job] } })
        }
        onDelete={requestDeleteJob}
      />
      <MotifLibraryModal
        open={motifsOpen}
        onOpenChange={setMotifsOpen}
        motifs={motifsQuery.data ?? []}
        selectedIds={selectedMotifs.map((motif) => motif.id)}
        max={MAX_DESIGN_MOTIFS}
        loading={motifsQuery.isPending}
        error={motifsQuery.isError}
        onRetry={() => void motifsQuery.refetch()}
        onToggle={toggleMotif}
        onDelete={requestDeleteMotif}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deleteTarget) closeDeleteConfirm(deleteTarget);
        }}
        title={
          deleteTarget?.kind === "session"
            ? "세션을 삭제할까요?"
            : deleteTarget?.kind === "job"
              ? "완성본을 삭제할까요?"
              : "모티프를 삭제할까요?"
        }
        description={
          deleteTarget?.kind === "session"
            ? "대화 이력이 함께 삭제돼요. 완성한 실사화 결과는 내 완성본에 남아요."
            : deleteTarget?.kind === "job"
              ? "삭제한 완성본은 복구할 수 없어요. 이미 접수한 주문에는 영향이 없어요."
              : `‘${deleteTarget?.name ?? "선택한 모티프"}’를 목록에서 삭제해요. 이미 만든 디자인에는 영향이 없어요.`
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
  finalizeExhausted,
  loading,
  onVariation,
  onExport,
  onFinalize,
}: {
  selected: boolean;
  canExport: boolean;
  finalizeExhausted: boolean;
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
        다시만들기
      </ActionButton>
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        disabled={!canExport}
        onClick={onExport}
      >
        <Icon svg={<ArrowDownTrayIcon />} size={18} />
        내려받기
      </ActionButton>
      <ActionButton
        type="button"
        size="small"
        variant="neutralOutline"
        disabled={!selected || finalizeExhausted}
        onClick={onFinalize}
      >
        <Icon svg={<Squares2X2Icon />} size={18} />
        실사화하기
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
