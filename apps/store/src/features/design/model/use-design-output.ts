import { exportDesign } from "@essesion/api-client";
import { snackbar } from "@essesion/shared";
import { useEffect, useState } from "react";

import type { ExportDialogValue } from "@/features/design/ui/export-dialog";
import type { FinalizeDialogValue } from "@/features/design/ui/finalize-dialog";

import { designErrorMessage, parseDesignError } from "./errors";
import { renderTiePng } from "./tie-image";
import { useCreateFinalizeJob, useFinalizeJobQuery } from "./use-finalize-job";

/** 타일은 실측 크기 그대로라 픽셀 수가 작다 — 워커 상한(max_dpi)까지 올린다. */
const TILE_DPI = 600;

/** 내려받기 — 이미 만든 SVG의 형식 변환이라 토큰이 들지 않는다. */
export function useDesignExport(options: {
  sessionId: string | null;
  svg: string | null;
  onDone: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  const submit = async (value: ExportDialogValue) => {
    if (!options.svg || exporting) return;
    setExporting(true);
    try {
      // 넥타이는 화면 미리보기와 같은 그림이라 브라우저에서 합성한다.
      const file =
        value.mode === "tie"
          ? await renderTiePng(options.svg)
          : await exportTilePng(options.svg, options.sessionId);
      download(
        file,
        `essesion-design-${value.mode === "tie" ? "tie" : "tile"}.png`,
      );
      options.onDone();
      snackbar("디자인 파일을 만들었습니다.");
    } catch (error) {
      snackbar(parseDesignError(error).message);
    } finally {
      setExporting(false);
    }
  };

  return {
    exporting,
    submit: (value: ExportDialogValue) => void submit(value),
  };
}

/**
 * 실사화 — 비동기 잡이라 시작 후 종결까지 폴링하고 결과를 스낵바로 알린다.
 * 완성본 자체는 `완성본` 목록에 쌓인다.
 */
export function useFinalizeFlow(options: {
  sessionId: string | null;
  authenticated: boolean;
  onStarted: () => void;
}) {
  const [jobId, setJobId] = useState<string | null>(null);
  const mutation = useCreateFinalizeJob();
  const jobQuery = useFinalizeJobQuery(jobId, options.authenticated);

  useEffect(() => {
    const job = jobQuery.data;
    if (!job || job.id !== jobId) return;
    if (job.status === "succeeded") {
      snackbar("실사화가 끝났어요. 완성본에서 확인할 수 있어요.");
      setJobId(null);
    } else if (job.status === "failed" || job.status === "canceled") {
      snackbar(job.error_message ?? "실사화를 완료하지 못했어요.");
      setJobId(null);
    }
  }, [jobId, jobQuery.data]);

  const submit = async (value: FinalizeDialogValue) => {
    const sessionId = options.sessionId;
    if (!sessionId || mutation.isPending) return;
    try {
      const result = await mutation.mutateAsync({
        sessionId,
        request: {
          production_method: value.productionMethod,
          weave: value.weave,
          dpi: value.dpi,
        },
      });
      setJobId(result.job.id);
      options.onStarted();
      snackbar("실사화를 시작했어요. 끝나면 알려드릴게요.");
    } catch (error) {
      snackbar(designErrorMessage(error, "실사화를 시작하지 못했습니다."));
    }
  };

  return {
    loading: mutation.isPending,
    submit: (value: FinalizeDialogValue) => void submit(value),
  };
}

/** 타일은 이어붙일 수 있는 원본 — 디자인의 실측 크기(합성기가 쓰는 `width="48mm"`)로 래스터한다. */
async function exportTilePng(svg: string, sessionId: string | null) {
  const response = await exportDesign({
    body: {
      session_id: sessionId,
      svg,
      format: "png",
      dpi: TILE_DPI,
      width_mm: Number(svg.match(/width="([\d.]+)mm"/)?.[1]) || 100,
    },
    parseAs: "blob",
    throwOnError: true,
  });
  if (!(response.data instanceof Blob)) {
    throw new Error("내려받기 응답이 파일 형식이 아닙니다.");
  }
  return response.data;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // 다운로드 시작은 비동기 — 즉시 revoke하면 파일이 비는 브라우저가 있다.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
