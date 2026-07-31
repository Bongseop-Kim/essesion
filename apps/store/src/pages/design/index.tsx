import { listUserMotifsQueryKey } from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  type DesignPreviewMode,
  Icon,
  PageBanner,
  snackbar,
  Text,
} from "@essesion/shared";
import { LightBulbIcon } from "@heroicons/react/24/outline";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
import {
  DESIGN_SVG_ACCEPT,
  importDesignMotif,
} from "@/features/design/api/attachments";
import {
  createDesignIdeas,
  extractDesignPalette,
} from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import {
  isMotifPanelCollapsed,
  setMotifPanelCollapsed,
} from "@/features/design/model/motif-panel-state";
import { isDesignOnboardingComplete } from "@/features/design/model/onboarding";
import {
  clearPendingDesign,
  readPendingDesign,
} from "@/features/design/model/pending";
import {
  designSessionQueryOptions,
  designSessionsQueryOptions,
  designTokenBalanceQueryOptions,
  designTurnsQueryOptions,
} from "@/features/design/model/queries";
import { readDesignHistory } from "@/features/design/model/steps";
import { svgToDataUri } from "@/features/design/model/svg-preview";
import {
  useDesignExport,
  useFinalizeFlow,
} from "@/features/design/model/use-design-output";
import { usePromptGeneration } from "@/features/design/model/use-prompt-generation";
import {
  useActivateDesignStep,
  useActivateMotifSlot,
} from "@/features/design/model/use-steps";
import {
  CanvasNoticeLayer,
  designNotices,
} from "@/features/design/ui/canvas-notice";
import { DesignCanvas } from "@/features/design/ui/design-canvas";
import {
  type DesignOverlayName,
  DesignOverlays,
} from "@/features/design/ui/design-overlays";
import { HistoryTrack } from "@/features/design/ui/history-track";
import { MotifPanel } from "@/features/design/ui/motif-panel";
import { PromptBar } from "@/features/design/ui/prompt-bar";
import {
  TokenPill,
  TokenPillPlaceholder,
} from "@/features/design/ui/token-pill";
import { ToolRail } from "@/features/design/ui/tool-rail";
import { ViewToggle } from "@/features/design/ui/view-toggle";
import { useSession } from "@/shared/store/session";

const DESCRIPTION =
  "AI와 함께 반복 가능한 넥타이 패턴을 만들고 실사화까지 확인하세요.";

/** 풀블리드 캔버스 + 떠 있는 컨트롤 4그룹을 조립하는 컨테이너. */
export function DesignPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const status = useSession((state) => state.status);
  const authenticated = status === "authenticated";
  const { requireAuth } = useAuthGuard();
  const ensureAuth = () => requireAuth({ path: "/design" });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [freshSession, setFreshSession] = useState(false);
  const [previewMode, setPreviewMode] = useState<DesignPreviewMode>("tie");
  const [overlay, setOverlay] = useState<DesignOverlayName | null>(() =>
    isDesignOnboardingComplete() ? null : "onboarding",
  );
  const [motifSlot, setMotifSlot] = useState<1 | 2>(1);
  const [collapsed, setCollapsed] = useState(() => isMotifPanelCollapsed());
  const [pending, setPending] = useState(() => readPendingDesign());
  const svgInputRef = useRef<HTMLInputElement>(null);

  const sessionsQuery = useQuery(designSessionsQueryOptions(authenticated));
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId, authenticated }),
  );
  const turnsQuery = useQuery(
    designTurnsQueryOptions({ sessionId, authenticated }),
  );
  const balanceQuery = useQuery(designTokenBalanceQueryOptions(authenticated));

  const history = useMemo(
    () => readDesignHistory(turnsQuery.data),
    [turnsQuery.data],
  );
  const motifs = useMemo(
    () =>
      (sessionQuery.data?.current_motifs ?? []).map((motif) => ({
        motifId: motif.motif_id,
        name: motif.name,
        previewSvg: motif.preview_svg,
      })),
    [sessionQuery.data?.current_motifs],
  );
  const hasDesign = !!sessionQuery.data?.current_intent;
  const quota = sessionQuery.data?.finalize_quota ?? null;

  const activateStep = useActivateDesignStep();
  const activateMotif = useActivateMotifSlot();
  const editor = usePromptGeneration({
    sessionId,
    hasDesign,
    ensureAuth,
    blocked: activateStep.isPending || activateMotif.isPending,
    notify: snackbar,
    onSessionChange: (id) => {
      setSessionId(id);
      setFreshSession(false);
    },
  });
  const exporter = useDesignExport({
    sessionId,
    svg: history.currentSvg,
    onDone: () => setOverlay(null),
  });
  const finalize = useFinalizeFlow({
    sessionId,
    authenticated,
    onStarted: () => setOverlay(null),
  });
  const busy = editor.pending;
  const exportable = !!history.currentSvg && !busy;

  useEffect(() => {
    if (
      authenticated &&
      !sessionId &&
      !freshSession &&
      sessionsQuery.data?.[0]
    ) {
      setSessionId(sessionsQuery.data[0].id);
    }
  }, [authenticated, freshSession, sessionId, sessionsQuery.data]);

  const openSession = (nextSessionId: string | null, fresh: boolean) => {
    editor.reset();
    setSessionId(nextSessionId);
    setFreshSession(fresh);
  };

  const runOnSession = async (
    run: (id: string) => Promise<unknown>,
    fallback: string,
  ): Promise<boolean> => {
    if (!sessionId || !ensureAuth() || busy) return false;
    try {
      await run(sessionId);
      return true;
    } catch (error) {
      snackbar(designErrorMessage(error, fallback));
      return false;
    }
  };

  const replaceMotif = (motifId: string) =>
    runOnSession(async (id) => {
      await activateMotif.mutateAsync({
        sessionId: id,
        slot: motifSlot,
        motifId,
      });
      setOverlay(null);
    }, "모티프를 바꾸지 못했습니다.");

  const importMotifFile = async (file: File) => {
    try {
      const motif = await importDesignMotif(file);
      await queryClient.invalidateQueries({
        queryKey: listUserMotifsQueryKey(),
      });
      // 활성화가 건너뛰어지거나 실패하면 성공 안내를 내지 않는다(실패 스낵바와 모순 방지).
      if (await replaceMotif(motif.motif_id)) {
        snackbar(`‘${motif.name}’ 모티프로 바꿨어요.`);
      }
    } catch (error) {
      snackbar(designErrorMessage(error, "SVG 모티프를 저장하지 못했습니다."));
    }
  };

  return (
    <>
      <title>AI 넥타이 디자인 | 영선산업</title>
      <meta name="description" content={DESCRIPTION} />
      <meta name="robots" content="noindex, nofollow" />
      <Text as="h1" className="sr-only">
        AI 넥타이 디자인
      </Text>
      {pending ? (
        <PageBanner
          tone="informative"
          title="진행 중이던 생성이 있어요"
          description="디자인을 열면 서버에 저장된 결과를 확인할 수 있어요."
          actionLabel="열기"
          onAction={() => {
            if (!ensureAuth()) return;
            openSession(pending.sessionId, false);
            clearPendingDesign();
            setPending(null);
          }}
        />
      ) : null}

      <DesignCanvas
        imageSrc={history.currentSvg ? svgToDataUri(history.currentSvg) : null}
        mode={previewMode}
        topStart={
          <ActionButton
            variant="neutralOutline"
            size="small"
            className="rounded-full bg-bg-layer-floating shadow-s1"
            onClick={() => setOverlay("onboarding")}
          >
            <Icon svg={<LightBulbIcon />} size={20} />
            만드는 방법
          </ActionButton>
        }
        topEnd={
          <>
            {authenticated ? (
              <TokenPill
                balance={balanceQuery.data?.total ?? null}
                generateCost={balanceQuery.data?.generate_cost ?? null}
                onPurchase={() => navigate("/token/purchase")}
              />
            ) : (
              <TokenPillPlaceholder />
            )}
            <ViewToggle mode={previewMode} onModeChange={setPreviewMode} />
          </>
        }
        notice={
          <CanvasNoticeLayer
            notices={designNotices({
              rejected: editor.rejected,
              errorMessage: editor.error?.detail ?? editor.error?.message,
              warnings: [
                ...editor.warnings,
                ...(activateMotif.data?.warnings ?? []),
              ],
            })}
          />
        }
        left={
          <MotifPanel
            motifs={motifs}
            collapsed={collapsed}
            onCollapsedChange={(next) => {
              setCollapsed(next);
              setMotifPanelCollapsed(next);
            }}
            onEditSlot={(slot) => {
              if (!ensureAuth()) return;
              setMotifSlot(slot);
              setOverlay("motifs");
            }}
            disabled={busy || !hasDesign}
          />
        }
        right={
          <ToolRail
            onExport={() => ensureAuth() && setOverlay("export")}
            onFinalize={() => ensureAuth() && setOverlay("finalize")}
            onPhotos={() => ensureAuth() && setOverlay("photos")}
            onColors={() => setOverlay("colors")}
            onSessions={() => setOverlay("sessions")}
            onFinalized={() => setOverlay("finalized")}
            onNewSession={() => openSession(null, true)}
            canExport={exportable}
            canFinalize={
              hasDesign && !busy && !(quota !== null && quota.remaining <= 0)
            }
            canAttachPhotos={!hasDesign && !busy}
            photosAttached={editor.photos.photos.length > 0}
            paletteFixed={editor.palette.mode === "fixed"}
            authenticated={authenticated}
            busy={busy}
          />
        }
        bottom={
          <>
            <HistoryTrack
              cells={history.cells}
              currentRunId={history.currentRunId}
              pending={editor.generating || activateMotif.isPending}
              disabled={busy}
              onSelect={(runId) =>
                void runOnSession(
                  (id) => activateStep.mutateAsync({ sessionId: id, runId }),
                  "그 스텝으로 되돌리지 못했습니다.",
                )
              }
            />
            <Box width="full" maxWidth={860}>
              <PromptBar
                value={editor.prompt}
                onChange={editor.changePrompt}
                onSubmit={editor.submit}
                onOpenIdeas={() => ensureAuth() && setOverlay("ideas")}
                placeholder={
                  hasDesign
                    ? "무엇을 바꿀까요? 색, 줄무늬, 배치, 크기"
                    : "원하는 색상, 무늬, 분위기를 입력하세요"
                }
                loading={busy}
                disabled={status === "loading"}
                selectSignal={editor.selectSignal}
              />
            </Box>
          </>
        }
      />

      <input
        ref={svgInputRef}
        type="file"
        accept={DESIGN_SVG_ACCEPT}
        aria-label="SVG 모티프 파일 선택"
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void importMotifFile(file);
        }}
      />
      <DesignOverlays
        overlay={overlay}
        onOverlayChange={setOverlay}
        authenticated={authenticated}
        activeSessionId={sessionId}
        onSelectSession={(id) => openSession(id, false)}
        onSessionDeleted={(id) => {
          if (sessionId === id) openSession(null, false);
        }}
        onOnboardingComplete={() => setOverlay(null)}
        activeMotifIds={motifs.map((motif) => motif.motifId)}
        onSelectMotif={(motifId) => void replaceMotif(motifId)}
        onImportSvg={() => svgInputRef.current?.click()}
        photos={editor.photos.photos}
        onAddPhotos={(files) => ensureAuth() && editor.photos.add(files)}
        onRemovePhoto={editor.photos.remove}
        onExtractPalette={async (photoId) =>
          extractDesignPalette(await editor.photos.uploadIdOf(photoId))
        }
        palette={editor.palette}
        onPaletteChange={editor.setPalette}
        prompt={editor.prompt}
        onPromptChange={editor.changePrompt}
        onRequestIdeas={async () =>
          createDesignIdeas({
            prompt: editor.prompt.trim(),
            referenceImages: hasDesign
              ? []
              : await editor.photos.referenceImages(),
            userMotifIds: [],
            palette: editor.palette,
          })
        }
        finalizeRemaining={quota?.remaining ?? null}
        finalizeResetAt={quota?.reset_at ?? null}
        onFinalize={finalize.submit}
        finalizeLoading={finalize.loading}
        finalizeDisabled={!hasDesign || busy}
        onExport={exporter.submit}
        exportLoading={exporter.exporting}
        exportDisabled={!exportable}
      />
    </>
  );
}
