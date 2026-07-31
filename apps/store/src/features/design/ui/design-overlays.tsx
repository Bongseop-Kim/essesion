import { deleteUserMotif, type UserMotifOut } from "@essesion/api-client";
import {
  listUserMotifsOptions,
  listUserMotifsQueryKey,
} from "@essesion/api-client/query";
import { AlertDialog, snackbar } from "@essesion/shared";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { DesignPalette } from "@/features/design/model/draft";
import { designErrorMessage } from "@/features/design/model/errors";
import { completeDesignOnboarding } from "@/features/design/model/onboarding";
import {
  designSessionsQueryOptions,
  finalizedJobsInfiniteQueryOptions,
} from "@/features/design/model/queries";
import {
  useDeleteDesignSession,
  useDeleteFinalizedJob,
} from "@/features/design/model/use-delete";
import type { PhotoReference } from "@/features/design/model/use-photo-references";
import { ColorSettingsModal } from "@/features/design/ui/color-settings-modal";
import {
  ExportDialog,
  type ExportDialogValue,
} from "@/features/design/ui/export-dialog";
import {
  FinalizeDialog,
  type FinalizeDialogValue,
} from "@/features/design/ui/finalize-dialog";
import { FinalizedListModal } from "@/features/design/ui/finalized-list-modal";
import { IdeasModal } from "@/features/design/ui/ideas-modal";
import { MotifLibraryModal } from "@/features/design/ui/motif-library-modal";
import { OnboardingDialog } from "@/features/design/ui/onboarding-dialog";
import { PhotoReferenceModal } from "@/features/design/ui/photo-reference-modal";
import { SessionListModal } from "@/features/design/ui/session-list-modal";

export type DesignOverlayName =
  | "onboarding"
  | "sessions"
  | "finalized"
  | "motifs"
  | "photos"
  | "colors"
  | "ideas"
  | "finalize"
  | "export";

// 모달 위 모달 금지 — 목록 모달이 닫히는 모션이 끝난 뒤 확인 다이얼로그를 연다.
const OVERLAY_EXIT_MS = 250;

type DeleteTarget =
  | { kind: "session"; id: string }
  | { kind: "job"; id: string }
  | { kind: "motif"; id: string; name: string };

export type DesignOverlaysProps = {
  /** 한 번에 하나만 — "모달 위 모달 금지"를 상태로 강제한다. */
  overlay: DesignOverlayName | null;
  onOverlayChange: (overlay: DesignOverlayName | null) => void;
  authenticated: boolean;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onSessionDeleted: (sessionId: string) => void;
  onOnboardingComplete: () => void;
  activeMotifIds: readonly string[];
  onSelectMotif: (motifId: string) => void;
  onImportSvg: () => void;
  photos: readonly PhotoReference[];
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (id: string) => void;
  onExtractPalette: (photoId: string) => Promise<string[]>;
  palette: DesignPalette;
  onPaletteChange: (palette: DesignPalette) => void;
  prompt: string;
  onPromptChange: (prompt: string) => void;
  onRequestIdeas: () => Promise<string[]>;
  finalizeRemaining: number | null;
  finalizeResetAt: string | null;
  onFinalize: (value: FinalizeDialogValue) => void;
  finalizeLoading: boolean;
  finalizeDisabled: boolean;
  onExport: (value: ExportDialogValue) => void;
  exportLoading: boolean;
  exportDisabled: boolean;
};

/**
 * 디자인 페이지의 오버레이 레이어 전체. 목록 조회와 삭제 확인 choreography를
 * 여기서 소유해 캔버스 컨테이너는 캔버스와 요청 흐름만 다룬다.
 */
export function DesignOverlays({
  overlay,
  onOverlayChange,
  authenticated,
  activeSessionId,
  onSelectSession,
  onSessionDeleted,
  onOnboardingComplete,
  activeMotifIds,
  onSelectMotif,
  onImportSvg,
  photos,
  onAddPhotos,
  onRemovePhoto,
  onExtractPalette,
  palette,
  onPaletteChange,
  prompt,
  onPromptChange,
  onRequestIdeas,
  finalizeRemaining,
  finalizeResetAt,
  onFinalize,
  finalizeLoading,
  finalizeDisabled,
  onExport,
  exportLoading,
  exportDisabled,
}: DesignOverlaysProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [motifDeleting, setMotifDeleting] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const sessionsQuery = useQuery(
    designSessionsQueryOptions(authenticated && overlay === "sessions"),
  );
  const finalizedJobsQuery = useInfiniteQuery(
    finalizedJobsInfiniteQueryOptions(authenticated && overlay === "finalized"),
  );
  const motifsQuery = useQuery({
    ...listUserMotifsOptions({ query: { limit: 100, offset: 0 } }),
    enabled: authenticated && overlay === "motifs",
  });
  const deleteSession = useDeleteDesignSession();
  const deleteJob = useDeleteFinalizedJob();
  const deleting =
    deleteSession.isPending || deleteJob.isPending || motifDeleting;

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const afterExit = (run: () => void) => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(run, reduced ? 0 : OVERLAY_EXIT_MS);
  };

  const requestDelete = (target: DeleteTarget) => {
    onOverlayChange(null);
    afterExit(() => setDeleteTarget(target));
  };

  // 확인 다이얼로그가 닫히면(취소·성공 공통) 원래의 목록 모달로 돌아간다.
  const closeConfirm = (target: DeleteTarget) => {
    setDeleteTarget(null);
    afterExit(() =>
      onOverlayChange(
        target.kind === "session"
          ? "sessions"
          : target.kind === "job"
            ? "finalized"
            : "motifs",
      ),
    );
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    const target = deleteTarget;
    try {
      if (target.kind === "session") {
        await deleteSession.mutateAsync(target.id);
        onSessionDeleted(target.id);
        snackbar("디자인을 삭제했습니다.");
      } else if (target.kind === "job") {
        await deleteJob.mutateAsync(target.id);
        snackbar("완성본을 삭제했습니다.");
      } else {
        setMotifDeleting(true);
        await deleteUserMotif({
          path: { user_motif_id: target.id },
          throwOnError: true,
        });
        await queryClient.invalidateQueries({
          queryKey: listUserMotifsQueryKey(),
        });
        snackbar("모티프를 삭제했습니다.");
      }
      closeConfirm(target);
    } catch (error) {
      snackbar(
        designErrorMessage(error, "삭제하지 못했습니다. 다시 시도해 주세요."),
      );
    } finally {
      setMotifDeleting(false);
    }
  };

  const change = (name: DesignOverlayName) => (open: boolean) =>
    onOverlayChange(open ? name : null);

  return (
    <>
      <OnboardingDialog
        open={overlay === "onboarding"}
        onOpenChange={change("onboarding")}
        onComplete={() => {
          completeDesignOnboarding();
          onOnboardingComplete();
        }}
      />
      <MotifLibraryModal
        open={overlay === "motifs"}
        onOpenChange={change("motifs")}
        motifs={motifsQuery.data ?? []}
        activeIds={activeMotifIds}
        loading={motifsQuery.isPending}
        error={motifsQuery.isError}
        onRetry={() => void motifsQuery.refetch()}
        onSelect={(motif: UserMotifOut) => onSelectMotif(motif.motif_id)}
        onDelete={(motif) =>
          requestDelete({ kind: "motif", id: motif.id, name: motif.name })
        }
        onImportSvg={onImportSvg}
      />
      <PhotoReferenceModal
        open={overlay === "photos"}
        onOpenChange={change("photos")}
        photos={photos}
        onAddFiles={onAddPhotos}
        onRemove={onRemovePhoto}
      />
      <ColorSettingsModal
        open={overlay === "colors"}
        value={palette}
        photos={photos.map((photo) => ({ id: photo.id, name: photo.name }))}
        onOpenChange={change("colors")}
        onApply={onPaletteChange}
        onExtract={onExtractPalette}
      />
      <IdeasModal
        open={overlay === "ideas"}
        currentPrompt={prompt}
        onOpenChange={change("ideas")}
        onRequest={onRequestIdeas}
        onApply={onPromptChange}
      />
      <FinalizeDialog
        open={overlay === "finalize"}
        onOpenChange={change("finalize")}
        onSubmit={onFinalize}
        remaining={finalizeRemaining}
        resetAt={finalizeResetAt}
        loading={finalizeLoading}
        disabled={finalizeDisabled}
      />
      <ExportDialog
        open={overlay === "export"}
        onOpenChange={change("export")}
        onSubmit={onExport}
        loading={exportLoading}
        disabled={exportDisabled}
      />
      <SessionListModal
        open={overlay === "sessions"}
        onOpenChange={change("sessions")}
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
        onSelect={(session) => {
          onSelectSession(session.id);
          onOverlayChange(null);
        }}
        onDelete={(session) =>
          requestDelete({ kind: "session", id: session.id })
        }
      />
      <FinalizedListModal
        open={overlay === "finalized"}
        onOpenChange={change("finalized")}
        jobs={finalizedJobsQuery.data?.pages.flat() ?? []}
        loading={finalizedJobsQuery.isPending}
        error={finalizedJobsQuery.isError}
        onRetry={() => void finalizedJobsQuery.refetch()}
        hasMore={finalizedJobsQuery.hasNextPage}
        loadingMore={finalizedJobsQuery.isFetchingNextPage}
        loadMoreError={finalizedJobsQuery.isFetchNextPageError}
        onLoadMore={() => void finalizedJobsQuery.fetchNextPage()}
        onOrder={(job) =>
          navigate("/custom-order", { state: { designJobs: [job] } })
        }
        onDelete={(job) => requestDelete({ kind: "job", id: job.id })}
      />
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && deleteTarget) closeConfirm(deleteTarget);
        }}
        title={DELETE_COPY[deleteTarget?.kind ?? "session"].title}
        description={
          deleteTarget?.kind === "motif"
            ? `‘${deleteTarget.name}’를 목록에서 삭제해요. 이미 만든 디자인에는 영향이 없어요.`
            : DELETE_COPY[deleteTarget?.kind ?? "session"].description
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
        secondaryActionProps={{ children: "취소", disabled: deleting }}
      />
    </>
  );
}

const DELETE_COPY = {
  session: {
    title: "이 디자인을 삭제할까요?",
    description:
      "편집 이력이 함께 삭제돼요. 완성한 실사화 결과는 완성본에 남아요.",
  },
  job: {
    title: "완성본을 삭제할까요?",
    description:
      "삭제한 완성본은 복구할 수 없어요. 이미 접수한 주문에는 영향이 없어요.",
  },
  motif: { title: "모티프를 삭제할까요?", description: "" },
} as const;
