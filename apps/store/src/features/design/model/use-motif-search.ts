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

/**
 * 모달 그리드의 한 칸. 무료 경로 전부(검색·내 모티프·SVG·사진·글자)가 이 한 형태로 모여
 * 확정 버튼 하나를 공유한다 — `motifId`는 바로 교체, `svg`뿐이면 확정할 때 import 한다.
 */
export type MotifCard = {
  key: string;
  name: string;
  previewSvg: string;
  motifId: string | null;
  svg: string | null;
  /** 내 모티프 목록의 행 id — 삭제 확인에 쓴다(카탈로그 id와 다르다) */
  userMotifId: string | null;
  /** 지금 이 슬롯이 쓰는 그림 — 무엇을 바꾸는 중인지 보이게 한 칸 차지한다 */
  current: boolean;
};

/** 그리드가 보여주는 목록의 출처 — `내 모티프` 칩이 토글한다. */
export type MotifSource = "search" | "library";

type Busy = "search" | "candidate" | "confirm" | "generate" | null;

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
  /** 교체·생성 성공 — 페이지가 모달을 닫고 결과를 알린다 */
  onDone: (name: string) => void;
};

/**
 * 모티프 모달의 상태와 호출 전부. 모달 컴포넌트가 아니라 페이지가 들고 있어서
 * 생성 확인 모달로 갔다 돌아와도 검색어·결과·선택이 유지된다(모달 위 모달 금지).
 */
export function useMotifSearch({
  sessionId,
  currentMotifs,
  recraftRemaining,
  onDone,
}: MotifSearchInput) {
  const queryClient = useQueryClient();
  const activate = useActivateMotifSlot();
  const [slot, setSlot] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<MotifSource>("search");
  const [results, setResults] = useState<MotifCard[] | null>(null);
  const [candidates, setCandidates] = useState<MotifCard[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [generatePrompt, setGeneratePrompt] = useState("");
  const [generateError, setGenerateError] = useState<string | null>(null);

  // 내 모티프는 칩을 누른 뒤에만 읽는다 — 목록을 통째로 노출하는 기본 경로가 없다.
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
        key: motif.motifId,
        name: "지금 쓰는 그림",
        previewSvg: motif.previewSvg,
        motifId: motif.motifId,
        svg: null,
        userMotifId: null,
        current: true,
      },
    ];
  };

  const cards: MotifCard[] =
    source === "library"
      ? (library.data ?? []).map((motif) => ({
          key: motif.motif_id,
          name: motif.name,
          previewSvg: motif.preview_svg,
          motifId: motif.motif_id,
          svg: null,
          userMotifId: motif.id,
          current: currentIds.includes(motif.motif_id),
        }))
      : [...candidates, ...(results ?? currentSlotCards())];

  const selected = cards.find((card) => card.key === selectedKey) ?? null;

  /** 슬롯을 열 때마다 처음부터 — 다른 슬롯의 검색어·선택이 새 나가지 않게. */
  const openSlot = (next: 1 | 2) => {
    setSlot(next);
    setQuery("");
    setSource("search");
    setResults(null);
    setCandidates([]);
    setSelectedKey(null);
    setBusy(null);
    setError(null);
    setWarnings([]);
    setGenerateError(null);
  };

  const search = async () => {
    const text = query.trim();
    if (!sessionId || !text || busy) return;
    setBusy("search");
    setError(null);
    setWarnings([]);
    setSource("search");
    try {
      const { data } = await searchMotifs({
        path: { session_id: sessionId },
        body: { query: text },
        throwOnError: true,
      });
      setResults(
        data.results.map((result) => ({
          key: result.motif_id,
          name: result.current ? "지금 쓰는 그림" : (result.name ?? "모티프"),
          previewSvg: result.preview_svg,
          motifId: result.motif_id,
          svg: null,
          userMotifId: null,
          current: result.current ?? false,
        })),
      );
      setSelectedKey(null);
    } catch (cause) {
      setResults(null);
      setError(designErrorMessage(cause, "모티프를 찾지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  /** 무료 경로 3종(SVG·사진·글자)의 공통 꼬리 — 만든 SVG를 카드로 세우고 고른다. */
  const addCandidate = async (
    name: string,
    make: () => Promise<{ svg: string; warnings?: string[] }>,
  ) => {
    if (busy) return;
    setBusy("candidate");
    setError(null);
    setWarnings([]);
    try {
      const made = await make();
      const key = `candidate-${name}-${made.svg.length}`;
      setSource("search");
      setCandidates((previous) => [
        {
          key,
          name,
          previewSvg: made.svg,
          motifId: null,
          svg: made.svg,
          userMotifId: null,
          current: false,
        },
        ...previous.filter((card) => card.key !== key),
      ]);
      setSelectedKey(key);
      setWarnings(made.warnings ?? []);
    } catch (cause) {
      setError(designErrorMessage(cause, "그림을 만들지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  const addSvgFile = (file: File) =>
    addCandidate(file.name.replace(/\.svg$/i, ""), async () => ({
      svg: await readDesignMotifSvg(file),
    }));

  const addPhotoFile = (file: File) =>
    addCandidate(file.name.replace(/\.[^.]+$/, ""), async () => {
      const uploadId = await uploadDesignPhoto(file);
      const preview = await previewPhotoMotif({
        uploadId,
        removeBackground: true,
        simplification: "medium",
        colorCount: 4,
      });
      return { svg: preview.svg, warnings: preview.warnings };
    });

  /** 글자 모티프는 위 입력창의 문장을 그대로 쓴다 — 입력창을 두 개 두지 않는다. */
  const addText = () => {
    const text = query.trim().slice(0, 20);
    if (!text) return Promise.resolve();
    return addCandidate(text, async () => {
      const preview = await previewTextMotif({
        text,
        fontId: "nanum-gothic",
        fontWeight: 400,
        letterSpacing: 0,
      });
      return { svg: preview.svg, warnings: preview.warnings };
    });
  };

  const replace = async (motifId: string, name: string) => {
    if (!sessionId) return;
    await activate.mutateAsync({ sessionId, slot, motifId });
    onDone(name);
  };

  /** 확정 — 카탈로그에 없는 카드만 먼저 import 하고, 나머지는 무과금 재렌더뿐이다. */
  const confirm = async () => {
    if (!sessionId || !selected || selected.current || busy) return;
    const card = selected;
    setBusy("confirm");
    setError(null);
    try {
      let motifId = card.motifId;
      if (!motifId) {
        const imported = await importDesignMotifSvg(card.name, card.svg ?? "");
        motifId = imported.motif_id;
        await queryClient.invalidateQueries({
          queryKey: listUserMotifsQueryKey(),
        });
      }
      await replace(motifId, card.name);
    } catch (cause) {
      setError(designErrorMessage(cause, "모티프를 바꾸지 못했습니다."));
    } finally {
      setBusy(null);
    }
  };

  /** 유료 경로 — 확인 모달에서만 호출된다. 성공하면 바로 슬롯에 넣는다. */
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
      await replace(data.motif.motif_id, data.motif.name ?? prompt);
    } catch (cause) {
      // 예산 소진이면 서버가 진실 — 세션을 다시 읽어 유료 행이 스스로 잠긴다.
      if (parseDesignError(cause).code === "recraft_budget_exhausted") {
        await queryClient.invalidateQueries({
          queryKey: designSessionQueryKey(sessionId),
        });
      }
      setGenerateError(
        designErrorMessage(cause, "모티프를 만들지 못했습니다."),
      );
    } finally {
      setBusy(null);
    }
  };

  return {
    openSlot,
    query,
    setQuery,
    source,
    setSource,
    cards,
    selectedKey,
    setSelectedKey,
    selected,
    search,
    addSvgFile,
    addPhotoFile,
    addText,
    confirm,
    generate,
    generatePrompt,
    setGeneratePrompt,
    generateError,
    error,
    warnings,
    /** 교체·생성이 만든 디자인 경고 — 상단 알림이 그린다. */
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
    replacing: busy === "confirm" || busy === "generate" || activate.isPending,
    /** 유료 행 상태 — 남은 횟수를 모르면 null, 0이면 잠긴다. */
    remaining: recraftRemaining,
    exhausted: recraftRemaining !== null && recraftRemaining <= 0,
  };
}

export type MotifSearchState = ReturnType<typeof useMotifSearch>;
