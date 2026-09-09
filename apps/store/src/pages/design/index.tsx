import type { DesignExampleOut } from "@essesion/api-client";
import {
  ActionButton,
  Box,
  ContentPlaceholder,
  type DesignPreviewMode,
  Flex,
  HStack,
  Skeleton,
  snackbar,
  Text,
  VStack,
} from "@essesion/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";

import { useAuthGuard } from "@/features/auth/ui/auth-guard-provider";
import { designErrorMessage } from "@/features/design/model/errors";
import {
  completeDesignOnboarding,
  isDesignOnboardingComplete,
} from "@/features/design/model/onboarding";
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
  designSessionQueryKey,
  designSessionQueryOptions,
  designSessionsQueryOptions,
  designTurnsQueryOptions,
} from "@/features/design/model/queries";
import { readDesignHistory } from "@/features/design/model/steps";
import {
  svgTileScale,
  svgToDataUri,
} from "@/features/design/model/svg-preview";
import { useActiveGeneration } from "@/features/design/model/use-active-generation";
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
import { CoachMark } from "@/features/design/ui/coach-mark";
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
  const queryClient = useQueryClient();
  const status = useSession((state) => state.status);
  const authenticated = status === "authenticated";
  const { requireAuth } = useAuthGuard();
  const ensureAuth = () => requireAuth({ path: "/design" });

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [freshSession, setFreshSession] = useState(false);
  const [previewMode, setPreviewMode] = useState<DesignPreviewMode>("tie");
  const [overlay, setOverlay] = useState<DesignOverlayName | null>(null);
  // 첫 진입 코치마크 — 복원·예시 로딩이 끝나고 다른 오버레이가 없을 때 한 번 뜬다(아래 effect).
  const [coachOpen, setCoachOpen] = useState(false);
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

  const clearPending = useCallback(() => setPending(null), []);
  // 서버가 아직 생성 중인지 — 새로고침으로 mutation을 잃어도 여기서 복구한다.
  const active = useActiveGeneration({
    sessionId,
    session: sessionQuery.data,
    onSettled: clearPending,
  });
  // 조회 실패를 "작업이 없음"과 구분한다 — 서버 오류가 작업 유실로 보이면 안 된다.
  const restoreFailures = [sessionsQuery, sessionQuery, turnsQuery].filter(
    (query) => query.isError,
  );
  const restoreFailed =
    authenticated && !freshSession && restoreFailures.length > 0;
  // 캔버스에 그릴 게 없을 때만 자리 표시로 바꾼다. 그림이 남아 있으면 유지한 채 알린다.
  const restoreLost = restoreFailed && !history.currentSvg;
  const retryRestore = () => {
    for (const query of restoreFailures) void query.refetch();
  };

  const examples = examplesQuery.data ?? [];
  // 세션 복원이 끝나기 전에는 빈 캔버스를 그리지 않는다 — 예시 갤러리가 깜빡였다가
  // 작업 중이던 디자인으로 교체되는 걸 막는다.
  const restoring =
    status === "loading" ||
    (authenticated &&
      !freshSession &&
      (sessionsQuery.isPending ||
        (!sessionId && !!sessionsQuery.data?.length) ||
        sessionQuery.isLoading ||
        turnsQuery.isLoading));

  const activateStep = useActivateDesignStep();
  const startExample = useStartDesignFromExample();
  const motifs = useMotifSearch({
    sessionId,
    currentMotifs: motifSlots,
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
      snackbar(
        intent.reason === "motif_mention"
          ? intent.subject
            ? `‘${intent.subject}’ 모티프는 카탈로그에 없어 넣지 못했어요. 왼쪽에서 찾거나 만들 수 있어요.`
            : "요청한 모티프는 카탈로그에 없어 넣지 못했어요. 왼쪽에서 찾거나 만들 수 있어요."
          : `${named}모티프는 왼쪽에서 찾거나 만들 수 있어요.`,
      );
    },
  });
  const exporter = useDesignExport({
    sessionId,
    svg: history.currentSvg,
    onDone: () => setOverlay(null),
  });
  const finalize = useFinalizeFlow({
    sessionId,
    // 응답이 곧 완성본 — 같은 뷰(완성본 모달)로 결과를 바로 보여준다.
    // 모달 위 모달 금지: 다이얼로그 닫힘 모션이 끝난 뒤 목록 모달을 연다.
    onDone: () => {
      setOverlay(null);
      const reduced = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      window.setTimeout(() => setOverlay("finalized"), reduced ? 0 : 250);
    },
  });
  // 복구 중에는 서버가 세션을 잠그고 있다 — 편집·교체·되돌리기를 함께 잠근다.
  const busy = editor.pending || activateStep.isPending || active.recovering;
  const exportable = !!history.currentSvg && !busy;

  useEffect(() => {
    if (restoring || examplesQuery.isPending || overlay !== null) return;
    if (isDesignOnboardingComplete()) return;
    setCoachOpen(true);
  }, [restoring, examplesQuery.isPending, overlay]);

  // 진행 중 다른 오버레이가 열리면 안내를 끝낸다(모달 위 모달 금지). 조작을 시작했으니 "봤음".
  useEffect(() => {
    if (overlay !== null && coachOpen) {
      completeDesignOnboarding();
      setCoachOpen(false);
    }
  }, [overlay, coachOpen]);

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
    // 같은 세션을 다시 열어도 서버 상태를 명시적으로 다시 본다.
    if (nextSessionId) {
      void queryClient.invalidateQueries({
        queryKey: designSessionQueryKey(nextSessionId),
      });
    }
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
      {restoreFailed && !restoreLost ? (
        <PageNotice
          title="최신 상태를 불러오지 못했어요"
          description="화면의 디자인은 그대로예요. 다시 시도하면 최신 상태를 가져옵니다."
          actionLabel="다시 시도"
          onAction={retryRestore}
        />
      ) : active.expired ? (
        <PageNotice
          title="생성 결과를 아직 확인하지 못했어요"
          description="토큰은 서버가 정리해요. 다시 확인해 결과가 나왔는지 볼 수 있어요."
          actionLabel="다시 확인"
          onAction={() => void sessionQuery.refetch()}
        />
      ) : pending && pending.sessionId !== sessionId ? (
        <PageNotice
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
        tileScale={
          history.currentSvg ? svgTileScale(history.currentSvg) : undefined
        }
        empty={
          restoring ? (
            <Box height="full" maxWidth="full" style={{ aspectRatio: 1 }}>
              <Skeleton width="full" height="full" radius="r4" />
            </Box>
          ) : restoreLost ? (
            <ContentPlaceholder
              title="작업 중이던 디자인을 불러오지 못했어요"
              description="서버 조회가 실패했을 뿐이라 저장된 디자인은 사라지지 않았어요."
              action={
                <HStack gap="x2">
                  <ActionButton
                    variant="neutralWeak"
                    size="small"
                    onClick={retryRestore}
                  >
                    다시 시도
                  </ActionButton>
                  <ActionButton
                    variant="ghost"
                    size="small"
                    onClick={() => openSession(null, true)}
                  >
                    새로 시작
                  </ActionButton>
                </HStack>
              }
            />
          ) : !hasDesign && !busy && examples.length > 0 ? (
            <StarterGallery
              examples={examples}
              onSelect={(example) => void startFromExample(example)}
              disabled={startExample.isPending}
            />
          ) : undefined
        }
        mode={previewMode}
        topStart={
          <ViewToggle mode={previewMode} onModeChange={setPreviewMode} />
        }
        topEnd={
          authenticated ? (
            <TokenPill
              balance={balanceQuery.data?.total ?? null}
              generateCost={balanceQuery.data?.generate_cost ?? null}
              editCost={balanceQuery.data?.edit_cost ?? null}
              motifGenerateCost={balanceQuery.data?.motif_generate_cost ?? null}
              onPurchase={() => navigate("/token/purchase")}
              failed={balanceQuery.isLoadingError}
              onRetry={() => void balanceQuery.refetch()}
            />
          ) : null
        }
        notice={
          <CanvasNoticeLayer
            notices={designNotices({
              rejected: editor.rejected,
              rejectedReason: editor.rejectedReason,
              errorMessage: editor.error?.detail ?? editor.error?.message,
              warnings: [...editor.warnings, ...motifs.activateWarnings],
            })}
          />
        }
        left={
          <VStack alignItems="stretch" gap="x3">
            {/* 모바일은 우측 하단으로 띄운다(컨트롤 레이어 기준) — 좌측엔 이력 카드만 남고
                PC(md~)는 static으로 돌아가 이력 카드 위 원래 자리를 지킨다. */}
            <Box
              position={{ base: "absolute", md: "static" }}
              bottom={0}
              right={0}
            >
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
                pendingSlot={motifs.pendingSlot}
                activeSlot={overlay === "motifs" ? motifs.slot : null}
                hintSignal={motifHintSignal}
                startRequired={!hasDesign}
                disabled={busy}
              />
            </Box>
            <HistoryCard
              cells={history.designCells}
              currentIndex={history.currentIndex}
              pending={
                editor.generating || motifs.replacing || active.recovering
              }
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
            onSessions={() => ensureAuth() && setOverlay("sessions")}
            onFinalized={() => ensureAuth() && setOverlay("finalized")}
            onNewSession={() => ensureAuth() && openSession(null, true)}
            onHelp={() => setCoachOpen(true)}
            canExport={exportable}
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
              onFinalize={() => ensureAuth() && setOverlay("finalize")}
              canFinalize={hasDesign && !busy}
              hasDesign={hasDesign}
              onOpenTools={() => setMobileToolsOpen(true)}
              toolsOpen={mobileToolsOpen}
              // 여러 줄 입력창은 한 줄 높이에서 긴 문구를 잘라 보이므로 짧게 유지한다.
              placeholder={
                hasDesign ? "무엇을 바꿀까요?" : "원하는 넥타이를 알려주세요"
              }
              loading={busy}
              disabled={status === "loading" || restoreLost}
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
        historyCells={history.cells}
        historyCurrentRunId={history.currentRunId}
        onSelectStep={selectStep}
        motifs={motifs}
        motifGenerateCost={balanceQuery.data?.motif_generate_cost ?? null}
        finalizeCost={balanceQuery.data?.finalize_cost ?? null}
        onFinalize={finalize.submit}
        finalizeLoading={finalize.loading}
        finalizeDisabled={!hasDesign || busy}
        onExport={exporter.submit}
        exportLoading={exporter.exporting}
        exportDisabled={!exportable}
      />
      <CoachMark
        open={coachOpen}
        onClose={() => {
          completeDesignOnboarding();
          setCoachOpen(false);
        }}
      />
    </>
  );
}

/** 페이지 전체 공지 한 줄 — 페이지당 1개(shared 하네스의 오버레이·피드백 선택). */
function PageNotice({
  title,
  description,
  actionLabel,
  onAction,
}: {
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <Flex
      role="status"
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
          {title}
        </Text>
        <Text as="span" textStyle="bodySm">
          {description}
        </Text>
      </Flex>
      <ActionButton
        variant="ghost"
        size="xsmall"
        className="shrink-0 underline underline-offset-2"
        onClick={onAction}
      >
        {actionLabel}
      </ActionButton>
    </Flex>
  );
}
