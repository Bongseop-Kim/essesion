// @vitest-environment jsdom

import type { DesignGenerateOut, UserMotifOut } from "@essesion/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DesignPalette,
  DesignPatternConstraints,
} from "@/features/design/model/draft";
import { DESIGN_ONBOARDING_KEY } from "@/features/design/model/onboarding";
import type { ColorSettingsModalProps } from "@/features/design/ui/color-settings-modal";
import type { DesignComposerProps } from "@/features/design/ui/composer";
import type { PatternSettingsModalProps } from "@/features/design/ui/pattern-settings-modal";
import type { PhotoMotifModalProps } from "@/features/design/ui/photo-motif-modal";
import type { TextMotifModalProps } from "@/features/design/ui/text-motif-modal";
import { useSession } from "@/shared/store/session";

type PageHarness = {
  composer: DesignComposerProps | null;
  colors: ColorSettingsModalProps | null;
  textMotif: TextMotifModalProps | null;
  photoMotif: PhotoMotifModalProps | null;
  pattern: PatternSettingsModalProps | null;
};

const api = vi.hoisted(() => ({
  createSession: vi.fn(),
  generate: vi.fn(),
  importMotif: vi.fn(),
  uploadPhoto: vi.fn(),
}));
const page = vi.hoisted(() => ({
  composer: null,
  colors: null,
  textMotif: null,
  photoMotif: null,
  pattern: null,
})) as PageHarness;

vi.mock("@essesion/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@essesion/api-client")>();
  return {
    ...actual,
    createDesignSession: api.createSession,
    generateDesign: api.generate,
  };
});

vi.mock("@/features/auth", () => ({
  useAuthGuard: () => ({ requireAuth: () => true }),
}));

vi.mock("@/features/design/api/attachments", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/features/design/api/attachments")>();
  return {
    ...actual,
    importDesignMotif: api.importMotif,
    uploadDesignPhoto: api.uploadPhoto,
  };
});

vi.mock("@/features/design/model/queries", () => ({
  designSessionsQueryOptions: () => ({
    queryKey: ["page-design-sessions"],
    queryFn: async () => [],
  }),
  designSessionQueryKey: (sessionId: string) => [
    "page-design-session",
    sessionId,
  ],
  designSessionQueryOptions: ({ sessionId }: { sessionId: string | null }) => ({
    queryKey: ["page-design-session", sessionId],
    queryFn: async () => ({
      id: sessionId,
      status: "active",
      seed: null,
      colorway: null,
      registry_version: null,
      current_intent: null,
      recraft_used: 0,
      created_at: "2026-07-19T00:00:00Z",
      updated_at: "2026-07-19T00:00:00Z",
      finalize_quota: null,
    }),
    enabled: !!sessionId,
  }),
  designTurnsQueryKey: (sessionId: string) => ["page-design-turns", sessionId],
  designTurnsQueryOptions: ({ sessionId }: { sessionId: string | null }) => ({
    queryKey: ["page-design-turns", sessionId],
    queryFn: async () => [],
    enabled: !!sessionId,
  }),
  generationJobsQueryKey: () => ["page-generation-jobs"],
  generationJobsQueryOptions: ({
    authenticated,
  }: {
    authenticated: boolean;
  }) => ({
    queryKey: ["page-generation-jobs"],
    queryFn: async () => [],
    enabled: authenticated,
  }),
  generationJobQueryKey: (jobId: string) => ["page-generation-job", jobId],
  generationJobQueryOptions: ({ jobId }: { jobId: string | null }) => ({
    queryKey: ["page-generation-job", jobId],
    queryFn: async () => null,
    enabled: !!jobId,
  }),
  finalizedJobsInfiniteQueryOptions: (authenticated: boolean) => ({
    queryKey: ["page-finalized-jobs"],
    queryFn: async () => [],
    enabled: authenticated,
    initialPageParam: 0,
    getNextPageParam: () => undefined,
  }),
  designTokenBalanceQueryOptions: () => ({
    queryKey: ["page-design-balance"],
    queryFn: async () => ({ total: 30, generate_cost: 5 }),
  }),
}));

vi.mock("@/features/design/ui/composer", () => ({
  ComposerPanelItem: () => null,
  DesignComposer: (props: DesignComposerProps) => {
    page.composer = props;
    return null;
  },
}));

vi.mock("@/features/design/ui/color-settings-modal", () => ({
  ColorSettingsModal: (props: ColorSettingsModalProps) => {
    page.colors = props;
    return null;
  },
}));

vi.mock("@/features/design/ui/text-motif-modal", () => ({
  TextMotifModal: (props: TextMotifModalProps) => {
    page.textMotif = props;
    return null;
  },
}));

vi.mock("@/features/design/ui/photo-motif-modal", () => ({
  PhotoMotifModal: (props: PhotoMotifModalProps) => {
    page.photoMotif = props;
    return null;
  },
}));

vi.mock("@/features/design/ui/pattern-settings-modal", () => ({
  PatternSettingsModal: (props: PatternSettingsModalProps) => {
    page.pattern = props;
    return null;
  },
}));

vi.mock("@/features/design/ui/turn-feed", () => ({ TurnFeed: () => null }));
vi.mock("@/features/design/ui/preview-panel", () => ({
  PreviewPanel: () => null,
}));
vi.mock("@/features/design/ui/preview-modal", () => ({
  PreviewModal: () => null,
}));
vi.mock("@/features/design/ui/ideas-modal", () => ({ IdeasModal: () => null }));
vi.mock("@/features/design/ui/motif-library-modal", () => ({
  MotifLibraryModal: () => null,
}));
vi.mock("@/features/design/ui/session-list-modal", () => ({
  SessionListModal: () => null,
}));
vi.mock("@/features/design/ui/finalized-list-modal", () => ({
  FinalizedListModal: () => null,
}));
vi.mock("@/features/design/ui/finalize-dialog", () => ({
  FinalizeDialog: () => null,
}));
vi.mock("@/features/design/ui/finalize-turn-card", () => ({
  FinalizeTurnCard: () => null,
}));
vi.mock("@/features/design/ui/export-dialog", () => ({
  ExportDialog: () => null,
}));
vi.mock("@/features/design/ui/onboarding-dialog", () => ({
  OnboardingDialog: () => null,
}));

import { DesignPage } from "./index";

const generated = {
  generation_log_id: "11111111-1111-4111-8111-111111111111",
  request_id: "request-1",
  registry_version: "registry-1",
  engine_version: "engine-1",
  intents: [],
  warnings: [],
  candidates: [],
} satisfies DesignGenerateOut;

const motif = {
  id: "11111111-1111-1111-1111-111111111111",
  motif_id: "upload-a1b2c3d4e5f6",
  name: "내 모티프",
  preview_svg: "<svg/>",
  created_at: "2026-07-19T00:00:00Z",
} satisfies UserMotifOut;

const fixedPalette = {
  mode: "fixed",
  colors: ["#112233", "#AABBCC"],
} satisfies DesignPalette;

const fixedPattern = {
  motifScale: "small",
  density: "dense",
  arrangement: "staggered",
  direction: "diagonal",
} satisfies DesignPatternConstraints;

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

describe("DesignPage composer lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    page.composer = null;
    page.colors = null;
    page.textMotif = null;
    page.photoMotif = null;
    page.pattern = null;
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("sessionStorage", memoryStorage());
    localStorage.setItem(DESIGN_ONBOARDING_KEY, "1");
    sessionStorage.clear();
    useSession.setState({
      status: "authenticated",
      accessToken: "access-token",
      user: null,
    });
    api.createSession.mockResolvedValue({ data: { id: "session-1" } });
    api.uploadPhoto.mockResolvedValue("upload-1");
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "local-photo-1"),
      getRandomValues: (values: Uint32Array) => values,
    });
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    URL.createObjectURL = vi.fn(() => "blob:reference");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    sessionStorage.clear();
    vi.unstubAllGlobals();
    useSession.setState({ status: "anonymous", accessToken: null, user: null });
  });

  it("실패한 작성 상태와 upload ID를 재사용하고 성공한 뒤 일회성 상태를 초기화한다", async () => {
    api.generate
      .mockRejectedValueOnce({
        code: "authoring_invalid",
        stage: "authoring",
        detail: "디자인 구성을 만들지 못했습니다",
      })
      .mockResolvedValueOnce({ data: generated });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <MemoryRouter initialEntries={["/design"]}>
        <QueryClientProvider client={queryClient}>
          <DesignPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(page.composer).not.toBeNull();
    expect(page.colors).not.toBeNull();
    expect(page.textMotif).not.toBeNull();
    expect(page.photoMotif).not.toBeNull();
    expect(page.pattern).not.toBeNull();

    const photo = new File(["photo"], "reference.png", { type: "image/png" });
    act(() => {
      page.composer?.onPromptChange("차분한 기하학 패턴");
      page.composer?.onCandidateCountChange(3);
      page.composer?.onPhotoFilesSelect([photo]);
      page.colors?.onApply(fixedPalette);
      page.pattern?.onApply(fixedPattern);
      page.textMotif?.onCreated(motif);
    });
    await waitFor(() => expect(page.composer?.attachments).toHaveLength(2));
    const photoAttachment = page.composer?.attachments?.find(
      (attachment) => attachment.kind === "photo",
    );
    expect(photoAttachment).toBeDefined();
    act(() => {
      if (photoAttachment) {
        page.composer?.onPhotoPurposeChange?.(
          photoAttachment.id,
          "composition",
        );
      }
    });

    act(() => page.composer?.onSubmit());
    await screen.findByText("디자인 구성을 만들지 못했어요");

    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(page.composer?.prompt).toBe("차분한 기하학 패턴");
    expect(page.composer?.candidateCount).toBe(3);
    expect(page.composer?.attachments).toEqual([
      expect.objectContaining({
        kind: "photo",
        name: "reference.png",
        purpose: "composition",
      }),
      expect.objectContaining({ kind: "motif", name: "내 모티프" }),
    ]);
    expect(page.composer?.paletteColors).toEqual(fixedPalette.colors);
    expect(page.composer?.patternSummary).toEqual([
      "작게",
      "촘촘하게",
      "엇갈림",
      "대각선",
    ]);
    expect(api.generate).toHaveBeenNthCalledWith(1, {
      body: expect.objectContaining({
        prompt: "차분한 기하학 패턴",
        candidate_count: 3,
        reference_images: [{ upload_id: "upload-1", purpose: "composition" }],
        user_motif_ids: [motif.id],
        palette: fixedPalette,
        pattern_constraints: {
          motif_scale: "small",
          density: "dense",
          arrangement: "staggered",
          direction: "diagonal",
        },
      }),
      throwOnError: true,
    });

    fireEvent.click(
      screen.getByRole("button", { name: /같은 요청 다시 시도/ }),
    );
    await waitFor(() => expect(api.generate).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(page.composer?.prompt).toBe("");
      expect(page.composer?.candidateCount).toBe(4);
      expect(page.composer?.attachments).toEqual([]);
      expect(page.composer?.paletteColors).toBeUndefined();
      expect(page.composer?.patternSummary).toEqual([]);
    });
    expect(api.createSession).toHaveBeenCalledTimes(1);
    expect(api.uploadPhoto).toHaveBeenCalledTimes(1);
    expect(api.generate.mock.calls[1]?.[0].body.reference_images).toEqual([
      { upload_id: "upload-1", purpose: "composition" },
    ]);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:reference");
    queryClient.clear();
  });

  it("일반 생성 거절의 다음 행동을 별도 content 없이 description에 표시한다", async () => {
    api.generate.mockRejectedValueOnce({
      code: "worker_rejected",
      detail: "이미지 워커가 요청을 거부했습니다",
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <MemoryRouter initialEntries={["/design"]}>
        <QueryClientProvider client={queryClient}>
          <DesignPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    act(() => page.composer?.onPromptChange("기하학 패턴"));
    act(() => page.composer?.onSubmit());

    await screen.findByText("요청을 이해하지 못했어요");
    const description = screen.getByText(
      "요청 내용을 조금 더 구체적으로 작성해 주세요. 실패한 요청의 토큰은 자동으로 환불돼요.",
    );
    expect(description.parentElement?.children).toHaveLength(2);
    queryClient.clear();
  });

  it("SVG 모티프는 파일 선택만으로 저장하고 이번 생성에 바로 선택한다", async () => {
    api.importMotif.mockResolvedValue(motif);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <MemoryRouter initialEntries={["/design"]}>
        <QueryClientProvider client={queryClient}>
          <DesignPage />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const file = new File(["<svg/>"], "로고.svg", { type: "image/svg+xml" });
    fireEvent.change(screen.getByLabelText("SVG 모티프 파일 선택"), {
      target: { files: [file] },
    });

    await waitFor(() => expect(api.importMotif).toHaveBeenCalledWith(file));
    await waitFor(() =>
      expect(page.composer?.attachments).toEqual([
        expect.objectContaining({ kind: "motif", name: "내 모티프" }),
      ]),
    );
    queryClient.clear();
  });
});
