import type { DesignExampleOut } from "@essesion/api-client";
import { listDesignExamplesOptions } from "@essesion/api-client/query";
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
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth";
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
import { useStartDesignFromExample } from "@/features/design/model/use-example-start";
import { useMotifSearch } from "@/features/design/model/use-motif-search";
import { usePromptGeneration } from "@/features/design/model/use-prompt-generation";
import { useActivateDesignStep } from "@/features/design/model/use-steps";
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
import { StarterGallery } from "@/features/design/ui/starter-gallery";
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
  const [collapsed, setCollapsed] = useState(() => isMotifPanelCollapsed());
  const [pending, setPending] = useState(() => readPendingDesign());

  const sessionsQuery = useQuery(designSessionsQueryOptions(authenticated));
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId, authenticated }),
  );
  const turnsQuery = useQuery(
    designTurnsQueryOptions({ sessionId, authenticated }),
  );
  const balanceQuery = useQuery(designTokenBalanceQueryOptions(authenticated));
  // 첫 진입 갤러리 — 공개 조회라 비로그인에도 뜬다.
  const examplesQuery = useQuery(listDesignExamplesOptions());

  const history = useMemo(
    () => readDesignHistory(turnsQuery.data),
    [turnsQuery.data],
  );
  const motifSlots = useMemo(
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

  const examples = examplesQuery.data ?? [];

  const activateStep = useActivateDesignStep();
  const startExample = useStartDesignFromExample();
  const motifs = useMotifSearch({
    sessionId,
    currentMotifs: motifSlots,
    recraftRemaining: sessionQuery.data?.recraft_remaining ?? null,
    onDone: (name) => {
      setOverlay(null);
      snackbar(`‘${name}’ 모티프로 바꿨어요.`);
    },
  });
  const editor = usePromptGeneration({
    sessionId,
    hasDesign,
    ensureAuth,
    blocked: activateStep.isPending || motifs.replacing,
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

  const startFromExample = async (example: DesignExampleOut) => {
    if (!ensureAuth()) return;
    try {
      const started = await startExample.mutateAsync(example.id);
      openSession(started.id, false);
      snackbar(`‘${example.name}’에서 시작했어요 · 토큰은 쓰지 않았어요`);
    } catch (error) {
      snackbar(designErrorMessage(error, "예시를 불러오지 못했습니다."));
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
        empty={
          !hasDesign &&
          !busy &&
          !sessionQuery.isLoading &&
          examples.length > 0 ? (
            <StarterGallery
              examples={examples}
              onSelect={(example) => void startFromExample(example)}
              disabled={startExample.isPending}
            />
          ) : undefined
        }
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
                editCost={balanceQuery.data?.edit_cost ?? null}
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
              warnings: [...editor.warnings, ...motifs.activateWarnings],
            })}
          />
        }
        left={
          <MotifPanel
            motifs={motifSlots}
            collapsed={collapsed}
            onCollapsedChange={(next) => {
              setCollapsed(next);
              setMotifPanelCollapsed(next);
            }}
            onEditSlot={(slot) => {
              if (!ensureAuth()) return;
              motifs.openSlot(slot);
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
              pending={editor.generating || motifs.replacing}
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
        motifs={motifs}
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
