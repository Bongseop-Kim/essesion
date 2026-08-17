import type { DesignExampleOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  type DesignPreviewMode,
  Flex,
  Icon,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { LightBulbIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import { createDesignIdeas } from "@/features/design/api/context-tools";
import { designErrorMessage } from "@/features/design/model/errors";
import { isDesignOnboardingComplete } from "@/features/design/model/onboarding";
import {
  HISTORY_CARD_COLLAPSED_KEY,
  isPanelCollapsed,
  MOTIF_PANEL_COLLAPSED_KEY,
  setPanelCollapsed,
} from "@/features/design/model/panel-collapsed";
import {
  clearPendingDesign,
  readPendingDesign,
} from "@/features/design/model/pending";
import {
  designSessionQueryOptions,
  designSessionsQueryOptions,
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
import { HistoryCard } from "@/features/design/ui/history-card";
import { MotifPanel } from "@/features/design/ui/motif-panel";
import { PromptBar } from "@/features/design/ui/prompt-bar";
import { StarterGallery } from "@/features/design/ui/starter-gallery";
import { TokenPill } from "@/features/design/ui/token-pill";
import { ToolRail } from "@/features/design/ui/tool-rail";
import { ViewToggle } from "@/features/design/ui/view-toggle";
import {
  designExamplesQueryOptions,
  tokenBalanceQueryOptions,
} from "@/shared/lib/live-queries";
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
  const [collapsed, setCollapsed] = useState(() =>
    isPanelCollapsed(MOTIF_PANEL_COLLAPSED_KEY),
  );
  const [historyCollapsed, setHistoryCollapsed] = useState(() =>
    isPanelCollapsed(HISTORY_CARD_COLLAPSED_KEY),
  );
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [motifHintSignal, setMotifHintSignal] = useState(0);
  const [pending, setPending] = useState(() => readPendingDesign());

  const sessionsQuery = useQuery(designSessionsQueryOptions(authenticated));
  const sessionQuery = useQuery(
    designSessionQueryOptions({ sessionId, authenticated }),
  );
  const turnsQuery = useQuery(
    designTurnsQueryOptions({ sessionId, authenticated }),
  );
  const balanceQuery = useQuery(tokenBalanceQueryOptions(authenticated));
  // 첫 진입 갤러리 — 공개 조회라 비로그인에도 뜬다.
  const examplesQuery = useQuery(designExamplesQueryOptions());

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
    motifGenerationRemaining:
      sessionQuery.data?.motif_generation_remaining ?? null,
    // 교체 결과는 캔버스·모티프 패널에 바로 보인다 — 따로 알리지 않는다.
    onDone: () => setOverlay(null),
    notify: snackbar,
  });
  const editor = usePromptGeneration({
    sessionId,
    ensureAuth,
    blocked: activateStep.isPending || motifs.replacing,
    onSessionChange: (id) => {
      setSessionId(id);
      setFreshSession(false);
    },
    onMotifIntent: (intent) => {
      setCollapsed(false);
      setPanelCollapsed(MOTIF_PANEL_COLLAPSED_KEY, false);
      motifs.openSlot(1, "search", intent.subject ?? undefined);
      setMotifHintSignal((signal) => signal + 1);
      const named = intent.subject ? `‘${intent.subject}’ ` : "";
      snackbar(`${named}모티프는 왼쪽에서 찾거나 만들 수 있어요.`);
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
  const busy = editor.pending || activateStep.isPending;
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

  /** 되돌리기 — 카드 스테퍼와 이력 모달이 같은 호출을 쓴다. */
  const selectStep = (runId: string) =>
    void runOnSession(
      (id) => activateStep.mutateAsync({ sessionId: id, runId }),
      "그 스텝으로 되돌리지 못했습니다.",
    );

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
        <Flex
          align="center"
          gap="x2"
          width="full"
          minHeight="x10"
          px="x4"
          py="x2_5"
          className="bg-bg-informative-weak text-fg-informative"
        >
          <Flex minWidth={0} flex={1} wrap align="baseline" gap="x1_5">
            <Text as="span" textStyle="bodySm" className="font-bold">
              진행 중이던 생성이 있어요
            </Text>
            <Text as="span" textStyle="bodySm">
              디자인을 열면 서버에 저장된 결과를 확인할 수 있어요.
            </Text>
          </Flex>
          <ActionButton
            variant="ghost"
            size="xsmall"
            className="shrink-0 underline underline-offset-2"
            onClick={() => {
              if (!ensureAuth()) return;
              openSession(pending.sessionId, false);
              clearPendingDesign();
              setPending(null);
            }}
          >
            열기
          </ActionButton>
        </Flex>
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
            className="whitespace-nowrap rounded-full bg-bg-layer-floating shadow-s1"
            onClick={() => setOverlay("onboarding")}
          >
            <Icon svg={<LightBulbIcon />} size={20} />
            Help
          </ActionButton>
        }
        topEnd={
          <Flex position="relative" alignItems="center" gap="x2">
            {authenticated ? (
              <Box
                position={{ base: "absolute", md: "static" }}
                top="x12"
                style={{ right: 0 }}
              >
                <TokenPill
                  balance={balanceQuery.data?.total ?? null}
                  generateCost={balanceQuery.data?.generate_cost ?? null}
                  editCost={balanceQuery.data?.edit_cost ?? null}
                  motifGenerateCost={
                    balanceQuery.data?.motif_generate_cost ?? null
                  }
                  onPurchase={() => navigate("/token/purchase")}
                />
              </Box>
            ) : null}
            <ViewToggle mode={previewMode} onModeChange={setPreviewMode} />
          </Flex>
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
          <VStack alignItems="stretch" gap="x3">
            <MotifPanel
              motifs={motifSlots}
              collapsed={collapsed}
              onCollapsedChange={(next) => {
                setCollapsed(next);
                setPanelCollapsed(MOTIF_PANEL_COLLAPSED_KEY, next);
              }}
              onPickSource={(slot, source) => {
                if (!ensureAuth()) return;
                motifs.openSlot(slot, source);
                setOverlay("motifs");
              }}
              onAddSvg={(slot, file) => {
                if (!ensureAuth()) return;
                void motifs.addSvgFile(slot, file);
              }}
              onAddPhoto={(slot, file) => {
                if (!ensureAuth()) return;
                motifs.openSlot(slot, "photo");
                void motifs.addPhotoFile(file);
                setOverlay("motifs");
              }}
              motifGenerationRemaining={
                sessionQuery.data?.motif_generation_remaining ?? null
              }
              pendingSlot={motifs.pendingSlot}
              activeSlot={overlay === "motifs" ? motifs.slot : null}
              hintSignal={motifHintSignal}
              startRequired={!hasDesign}
              disabled={busy}
            />
            <HistoryCard
              cells={history.designCells}
              currentIndex={history.currentIndex}
              pending={editor.generating || motifs.replacing}
              disabled={busy}
              collapsed={historyCollapsed}
              onCollapsedChange={(next) => {
                setHistoryCollapsed(next);
                setPanelCollapsed(HISTORY_CARD_COLLAPSED_KEY, next);
              }}
              onSelect={selectStep}
              onOpenAll={() => setOverlay("history")}
            />
          </VStack>
        }
        right={
          <ToolRail
            onExport={() => ensureAuth() && setOverlay("export")}
            onFinalize={() => ensureAuth() && setOverlay("finalize")}
            onSessions={() => ensureAuth() && setOverlay("sessions")}
            onFinalized={() => ensureAuth() && setOverlay("finalized")}
            onNewSession={() => ensureAuth() && openSession(null, true)}
            canExport={exportable}
            canFinalize={
              hasDesign && !busy && !(quota !== null && quota.remaining <= 0)
            }
            busy={busy}
            mobileOpen={mobileToolsOpen}
            onMobileOpenChange={setMobileToolsOpen}
          />
        }
        bottom={
          <Box width="full" maxWidth={860}>
            <PromptBar
              value={editor.prompt}
              onChange={editor.changePrompt}
              onSubmit={editor.submit}
              onOpenIdeas={() => ensureAuth() && setOverlay("ideas")}
              onOpenTools={() => setMobileToolsOpen(true)}
              toolsOpen={mobileToolsOpen}
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
        }
      />

      <DesignOverlays
        overlay={overlay}
        onOverlayChange={setOverlay}
        authenticated={authenticated}
        activeSessionId={sessionId}
        onSelectSession={(id) => openSession(id, false)}
        onSessionDeleted={(id) => {
          // fresh=true — 삭제 직후 다른 세션이 자동 선택되지 않고 빈 캔버스로 남는다.
          if (sessionId === id) openSession(null, true);
        }}
        onOnboardingComplete={() => setOverlay(null)}
        historyCells={history.cells}
        historyCurrentRunId={history.currentRunId}
        onSelectStep={selectStep}
        motifs={motifs}
        prompt={editor.prompt}
        onPromptChange={editor.changePrompt}
        onRequestIdeas={async () =>
          createDesignIdeas({
            prompt: editor.prompt.trim(),
            userMotifIds: [],
          })
        }
        finalizeRemaining={quota?.remaining ?? null}
        motifGenerateCost={balanceQuery.data?.motif_generate_cost ?? null}
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
