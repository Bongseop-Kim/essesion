import { generateMotif, searchMotifs } from "@essesion/api-client";
import {
  listUserMotifsOptions,
  listUserMotifsQueryKey,
} from "@essesion/api-client/query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  importDesignMotifSvg,
  readDesignMotifSvg,
  uploadDesignPhoto,
} from "@/features/design/api/attachments";
import {
  previewPhotoMotif,
  previewTextMotif,
} from "@/features/design/api/context-tools";
import {
  designErrorMessage,
  parseDesignError,
} from "@/features/design/model/errors";
import { designSessionQueryKey } from "@/features/design/model/queries";
import { useActivateMotifSlot } from "@/features/design/model/use-steps";

/** 그리드 한 칸 — 탐색 결과와 내 모티프만 그린다(만들기 결과는 결과 한 장으로 따로 본다). */
export type MotifCard = {
  motifId: string;
  name: string;
  previewSvg: string;
  /** 내 모티프 목록의 행 id — 삭제 확인에 쓴다(카탈로그 id와 다르다) */
  userMotifId: string | null;
  /** 지금 이 슬롯이 쓰는 그림 — 무엇을 바꾸는 중인지 보이게 한 칸 차지한다 */
  current: boolean;
};

/** 모달이 하는 일 하나 — 슬롯 메뉴에서 고른 소스가 그대로 모달의 정체다. */
export type MotifSource = "search" | "library" | "generate" | "text" | "photo";

/** 워커가 실제로 가진 글꼴만. 늘리려면 폰트 파일·해시와 api·worker Literal 확장이 먼저다. */
export type MotifFontId = "nanum-gothic" | "nanum-myeongjo";
export type MotifFontWeight = 400 | 700;

type Busy = "search" | "confirm" | "generate" | "text" | "photo" | null;

export type MotifSearchInput = {
  sessionId: string | null;
  /** 세션의 `current_motifs` — 슬롯의 현재 그림을 카드로 세운다 */
  currentMotifs: readonly {
    motifId: string;
    name: string | null;
    previewSvg: string;
  }[];
  /** 남은 생성 횟수(세션 예산). null이면 아직 모른다 — 문구에서 횟수를 뺀다 */
  recraftRemaining: number | null;
  /** 교체 성공 — 페이지가 모달을 닫고 결과를 알린다 */
  onDone: (name: string) => void;
  /** 모달 밖(SVG 직행)의 결과 알림 — Callout 자리가 없어 snackbar로만 말한다 */
  notify: (message: string) => void;
};

/**
 * 모티프 소스 5종의 상태와 호출 전부. 슬롯이 바뀔 때만 초기화하므로 같은 슬롯에서
 * 소스를 바꿔 오가도 입력·결과가 남는다.
 */
export function useMotifSearch({
  sessionId,
  currentMotifs,
  recraftRemaining,
  onDone,
  notify,
}: MotifSearchInput) {
  const queryClient = useQueryClient();
  const activate = useActivateMotifSlot();
  const [slot, setSlot] = useState<1 | 2>(1);
  const [source, setSource] = useState<MotifSource>("search");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  /** SVG 직행 — 모달 없이 슬롯 자리에서 진행을 보여준다 */
  const [pendingSlot, setPendingSlot] = useState<1 | 2 | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MotifCard[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{
    motifId: string;
    name: string;
    previewSvg: string;
    /** api가 내 모티프에 남겼는지 — 가득 차면 생성만 되고 저장은 건너뛴다 */
    saved: boolean;
  } | null>(null);
  const [text, setText] = useState("");
  const [fontId, setFontId] = useState<MotifFontId>("nanum-gothic");
  const [fontWeight, setFontWeight] = useState<MotifFontWeight>(400);
  const [textResult, setTextResult] = useState<{
    svg: string;
    name: string;
  } | null>(null);
  const [photoResult, setPhotoResult] = useState<{
    name: string;
    sizeBytes: number;
    /** 원본 미리보기 objectURL — 배경 제거 결과와 나란히 대조한다 */
    sourceUrl: string;
    /** 변환 전·실패면 null — 파일 행은 그대로 두고 결과 자리만 비운다 */
    svg: string | null;
  } | null>(null);

  // 내 모티프는 그 소스를 열었을 때만 읽는다 — 목록을 통째로 노출하는 기본 경로가 없다.
  const library = useQuery({
    ...listUserMotifsOptions({ query: { limit: 100, offset: 0 } }),
    enabled: !!sessionId && source === "library",
  });

  const currentIds = currentMotifs.map((motif) => motif.motifId);
  const currentSlotCards = (): MotifCard[] => {
    const motif = currentMotifs[slot - 1];
    if (!motif) return [];
    return [
      {
        motifId: motif.motifId,
        name: "지금 쓰는 그림",
        previewSvg: motif.previewSvg,
        userMotifId: null,
        current: true,
      },
    ];
  };

  const cards: MotifCard[] =
    source === "library"
      ? (library.data ?? []).map((motif) => ({
          motifId: motif.motif_id,
          name: motif.name,
          previewSvg: motif.preview_svg,
          userMotifId: motif.id,
          current: currentIds.includes(motif.motif_id),
        }))
      : (results ?? currentSlotCards());

  const selected = cards.find((card) => card.motifId === selectedId) ?? null;

  const clearPhoto = () =>
    setPhotoResult((previous) => {
      if (previous) URL.revokeObjectURL(previous.sourceUrl);
      return null;
    });

  /** 슬롯이 바뀔 때만 처음부터 — 같은 슬롯에서 소스만 바꾸면 앞서 쓰던 입력이 남는다. */
  const openSlot = (next: 1 | 2, nextSource: MotifSource) => {
    if (next !== slot) {
      setSlot(next);
      setQuery("");
      setResults(null);
      setSelectedId(null);
      setGeneratePrompt("");
      setGenerated(null);
      setGenerateError(null);
      setText("");
      setTextResult(null);
      clearPhoto();
    }
    setSource(nextSource);
    setBusy(null);
    setError(null);
    setWarnings([]);
  };

  const search = async () => {
    const value = query.trim();
    if (!sessionId || !value || busy) return;
    setBusy("search");
    setError(null);
    try {
      const { data } = await searchMotifs({
        path: { session_id: sessionId },
        body: { query: value },
        throwOnError: true,
      });
      setResults(
        data.results.map((result) => ({
          motifId: result.motif_id,
          name: result.current ? "지금 쓰는 그림" : (result.name ?? "모티프"),
          previewSvg: result.preview_svg,
          userMotifId: null,
          current: result.current ?? false,
        })),
      );
      setSelectedId(null);
    } catch (cause) {
      setResults(null);
      setError(designErrorMessage(cause, "모티프를 찾지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const replace = async (motifId: string, name: string) => {
    if (!sessionId) return;
    await activate.mutateAsync({ sessionId, slot, motifId });
    onDone(name);
  };

  /** 카탈로그에 없는 그림(사진·글자)의 공통 꼬리 — 내 모티프로 저장한 뒤 슬롯에 넣는다. */
  const importAndReplace = async (name: string, svg: string) => {
    const imported = await importDesignMotifSvg(name, svg);
    await queryClient.invalidateQueries({ queryKey: listUserMotifsQueryKey() });
    await replace(imported.motif_id, name);
  };

  /** 확정 — 탐색·내 모티프는 이미 카탈로그 id가 있어 교체만 한다. */
  const confirm = async () => {
    if (!sessionId || !selected || selected.current || busy) return;
    setBusy("confirm");
    setError(null);
    try {
      await replace(selected.motifId, selected.name);
    } catch (cause) {
      setError(designErrorMessage(cause, "모티프를 바꾸지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  /** SVG는 모달을 거치지 않는다 — 읽기·저장·교체를 한 번에 하고 슬롯이 진행을 보여준다. */
  const addSvgFile = async (target: 1 | 2, file: File) => {
    if (!sessionId || pendingSlot) return;
    setPendingSlot(target);
    try {
      const svg = await readDesignMotifSvg(file);
      const name = file.name.replace(/\.svg$/i, "");
      const imported = await importDesignMotifSvg(name, svg);
      await queryClient.invalidateQueries({
        queryKey: listUserMotifsQueryKey(),
      });
      await activate.mutateAsync({
        sessionId,
        slot: target,
        motifId: imported.motif_id,
      });
      notify("그림을 넣었어요 · 내 모티프에 저장했어요");
    } catch (cause) {
      notify(designErrorMessage(cause, "그림을 넣지 못했습니다."));
    } finally {
      setPendingSlot(null);
    }
  };

  /** 사진은 배경 제거만 한다 — 색·모양은 사진 그대로라 단순화 옵션을 두지 않는다. */
  const addPhotoFile = async (file: File) => {
    if (!sessionId || busy) return;
    clearPhoto();
    setBusy("photo");
    setError(null);
    setWarnings([]);
    const sourceUrl = URL.createObjectURL(file);
    setPhotoResult({
      name: file.name.replace(/\.[^.]+$/, ""),
      sizeBytes: file.size,
      sourceUrl,
      svg: null,
    });
    try {
      const uploadId = await uploadDesignPhoto(file);
      const preview = await previewPhotoMotif({
        uploadId,
        removeBackground: true,
        simplification: "low",
        colorCount: 6,
      });
      setPhotoResult((previous) =>
        previous?.sourceUrl === sourceUrl
          ? { ...previous, svg: preview.svg }
          : previous,
      );
      setWarnings(preview.warnings);
    } catch (cause) {
      setError(designErrorMessage(cause, "사진에서 그림을 따오지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const confirmPhoto = async () => {
    if (!sessionId || !photoResult?.svg || busy) return;
    setBusy("confirm");
    setError(null);
    try {
      await importAndReplace(photoResult.name, photoResult.svg);
    } catch (cause) {
      setError(designErrorMessage(cause, "그림을 넣지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const renderText = async (font: {
    fontId: MotifFontId;
    fontWeight: MotifFontWeight;
  }) => {
    const value = text.trim().slice(0, 20);
    if (!value || busy) return;
    setBusy("text");
    setError(null);
    setWarnings([]);
    try {
      const preview = await previewTextMotif({
        text: value,
        letterSpacing: 0,
        ...font,
      });
      setTextResult({ svg: preview.svg, name: value });
      setWarnings(preview.warnings);
    } catch (cause) {
      setError(designErrorMessage(cause, "글자를 그림으로 만들지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const addText = () => renderText({ fontId, fontWeight });

  // 글꼴·굵기는 무료·결정적이라 확인 버튼 없이 결과를 곧바로 다시 그린다.
  const changeFont = (next: MotifFontId) => {
    setFontId(next);
    if (textResult) void renderText({ fontId: next, fontWeight });
  };

  const changeFontWeight = (next: MotifFontWeight) => {
    setFontWeight(next);
    if (textResult) void renderText({ fontId, fontWeight: next });
  };

  const applyText = async () => {
    if (!sessionId || !textResult || busy) return;
    setBusy("confirm");
    setError(null);
    try {
      await importAndReplace(textResult.name, textResult.svg);
    } catch (cause) {
      setError(designErrorMessage(cause, "그림을 넣지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  /** 유일한 유료 경로 — 성공해도 적용하지 않는다. api가 내 모티프에 먼저 남긴다. */
  const generate = async () => {
    const prompt = generatePrompt.trim();
    if (!sessionId || !prompt || busy) return;
    setBusy("generate");
    setGenerateError(null);
    try {
      const { data } = await generateMotif({
        path: { session_id: sessionId },
        body: { prompt },
        throwOnError: true,
      });
      setGenerated({
        motifId: data.motif.motif_id,
        name: data.motif.name ?? prompt,
        previewSvg: data.motif.preview_svg,
        saved: data.saved,
      });
      await queryClient.invalidateQueries({
        queryKey: listUserMotifsQueryKey(),
      });
    } catch (cause) {
      // 예산 소진이면 서버가 진실 — 세션을 다시 읽어 입력이 스스로 잠긴다.
      if (parseDesignError(cause).code === "recraft_budget_exhausted") {
        await queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(sessionId),
        });
      }
      setGenerateError(
        designErrorMessage(
          cause,
          "횟수는 줄지 않았으니 문장을 조금 바꿔 다시 시도해 주세요.",
        ),
      );
    } finally {
      setBusy(null);
    }
  };

  const applyGenerated = async () => {
    if (!sessionId || !generated || busy) return;
    setBusy("confirm");
    setGenerateError(null);
    try {
      await replace(generated.motifId, generated.name);
    } catch (cause) {
      setGenerateError(
        designErrorMessage(cause, "모티프를 바꾸지 못했습니다."),
      );
    } finally {
      setBusy(null);
    }
  };

  return {
    slot,
    source,
    openSlot,
    query,
    setQuery,
    search,
    cards,
    selectedId,
    setSelectedId,
    selected,
    confirm,
    pendingSlot,
    addSvgFile,
    addPhotoFile,
    photoResult,
    confirmPhoto,
    text,
    setText,
    fontId,
    changeFont,
    fontWeight,
    changeFontWeight,
    textResult,
    addText,
    applyText,
    generatePrompt,
    setGeneratePrompt,
    generate,
    generated,
    applyGenerated,
    generateError,
    error,
    warnings,
    /** 교체가 만든 디자인 경고 — 상단 알림이 그린다. */
    activateWarnings: activate.data?.warnings ?? [],
    searching: busy === "search",
    /** 한 번이라도 검색했는지 — 빈 그리드 문구를 "찾지 못함"과 "아직 안 찾음"으로 가른다. */
    searched: results !== null,
    /** 목록 3상태 — 내 모티프만 서버 조회다(검색은 `searching`). */
    libraryLoading: source === "library" && library.isPending,
    libraryError: source === "library" && library.isError,
    refetchLibrary: () => void library.refetch(),
    /** 모달 안에서 무엇이든 진행 중 — 모달의 버튼을 잠근다. */
    working: busy !== null || activate.isPending,
    /** 디자인을 실제로 바꾸는 중 — 이력의 대기 칸과 입력창 잠금은 이것만 본다. */
    replacing: busy === "confirm" || activate.isPending || pendingSlot !== null,
    /** 유료 경로 상태 — 남은 횟수를 모르면 null, 0이면 잠긴다. */
    remaining: recraftRemaining,
    exhausted: recraftRemaining !== null && recraftRemaining <= 0,
  };
}

export type MotifSearchState = ReturnType<typeof useMotifSearch>;
