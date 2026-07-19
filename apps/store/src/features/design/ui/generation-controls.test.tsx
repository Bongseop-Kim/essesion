// @vitest-environment jsdom

import type { UserMotifOut } from "@essesion/api-client";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_PATTERN_CONSTRAINTS, type DesignPalette } from "../model/draft";
import { ColorSettingsModal } from "./color-settings-modal";
import { IdeasModal } from "./ideas-modal";
import { MotifAddModal } from "./motif-add-modal";
import { PatternSettingsModal } from "./pattern-settings-modal";

const motifApi = vi.hoisted(() => ({
  importSvg: vi.fn(),
  previewPhoto: vi.fn(),
  previewText: vi.fn(),
  readSvg: vi.fn(),
  uploadPhoto: vi.fn(),
}));

vi.mock("@/features/design/api/attachments", () => ({
  DESIGN_PHOTO_ACCEPT: "image/jpeg,image/png,image/webp",
  DESIGN_SVG_ACCEPT: ".svg,image/svg+xml",
  importDesignMotifSvg: motifApi.importSvg,
  readDesignMotifSvg: motifApi.readSvg,
  uploadDesignPhoto: motifApi.uploadPhoto,
}));

vi.mock("@/features/design/api/context-tools", () => ({
  previewPhotoMotif: motifApi.previewPhoto,
  previewTextMotif: motifApi.previewText,
}));

const motif: UserMotifOut = {
  id: "user-motif-1",
  motif_id: "motif-1",
  name: "YS",
  preview_svg: '<svg viewBox="0 0 1 1"></svg>',
  created_at: "2026-07-19T00:00:00Z",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("design generation controls", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute("open", "");
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute("open");
      },
    });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("HEX를 정규화해 2~5개의 고정 팔레트를 적용한다", () => {
    const onApply = vi.fn();
    render(
      <ColorSettingsModal
        open
        value={{ mode: "auto", colors: [] }}
        photos={[]}
        onOpenChange={vi.fn()}
        onApply={onApply}
        onExtract={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: /직접 선택/ }));
    fireEvent.change(screen.getByLabelText("1번째 HEX"), {
      target: { value: "#abc" },
    });
    fireEvent.change(screen.getByLabelText("2번째 HEX"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith({
      mode: "fixed",
      colors: ["#AABBCC", "#123456"],
    });
  });

  it("사진에서 추출한 색상을 적용하고 전체 자동으로 초기화한다", async () => {
    const onExtract = vi.fn().mockResolvedValue(["#112233", "#445566"]);
    const onApply = vi.fn();
    render(
      <ColorSettingsModal
        open
        value={{ mode: "fixed", colors: ["#AABBCC", "#DDEEFF"] }}
        photos={[{ id: "photo-1", name: "꽃.jpg" }]}
        onOpenChange={vi.fn()}
        onApply={onApply}
        onExtract={onExtract}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "대표 색상 추출" }));
    await waitFor(() => expect(onExtract).toHaveBeenCalledWith("photo-1"));
    expect((screen.getByLabelText("1번째 HEX") as HTMLInputElement).value).toBe(
      "#112233",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "전체 자동으로 초기화" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    expect(onApply).toHaveBeenCalledWith({ mode: "auto", colors: [] });
  });

  it("색상 추출 API의 검증 상세를 그대로 안내한다", async () => {
    render(
      <ColorSettingsModal
        open
        value={{ mode: "auto", colors: [] }}
        photos={[{ id: "photo-1", name: "꽃.jpg" }]}
        onOpenChange={vi.fn()}
        onApply={vi.fn()}
        onExtract={vi
          .fn()
          .mockRejectedValue({ detail: "사진 소유권이 없습니다." })}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "대표 색상 추출" }));
    await screen.findByText("사진 소유권이 없습니다.");
  });

  it("닫기·재열기 전 색상 추출 응답이 새 모달 상태를 덮지 않는다", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const onExtract = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const value: DesignPalette = { mode: "auto", colors: [] };
    const props = {
      value,
      photos: [{ id: "photo-1", name: "꽃.jpg" }],
      onOpenChange: vi.fn(),
      onApply: vi.fn(),
      onExtract,
    };
    const { rerender } = render(<ColorSettingsModal open {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "대표 색상 추출" }));
    await waitFor(() => expect(onExtract).toHaveBeenCalledOnce());

    rerender(<ColorSettingsModal open={false} {...props} />);
    rerender(<ColorSettingsModal open {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "대표 색상 추출" }));
    await waitFor(() => expect(onExtract).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(["#112233", "#445566"]);
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("1번째 HEX") as HTMLInputElement).value,
      ).toBe("#112233"),
    );
    await act(async () => {
      first.resolve(["#AABBCC", "#DDEEFF"]);
    });

    expect((screen.getByLabelText("1번째 HEX") as HTMLInputElement).value).toBe(
      "#112233",
    );
  });

  it("패턴 설정을 엔진 enum으로 적용하고 개별 자동 선택을 제공한다", () => {
    const onApply = vi.fn();
    render(
      <PatternSettingsModal
        open
        value={AUTO_PATTERN_CONSTRAINTS}
        onOpenChange={vi.fn()}
        onApply={onApply}
      />,
    );

    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "모티프 크기" })).getByRole(
        "radio",
        { name: "작게" },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "배열" })).getByRole(
        "radio",
        { name: /엇갈림/ },
      ),
    );
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "방향" })).getByRole(
        "radio",
        { name: "대각선" },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onApply).toHaveBeenCalledWith({
      motifScale: "small",
      density: "auto",
      arrangement: "staggered",
      direction: "diagonal",
    });
  });

  it("아이디어를 편집해 기존 프롬프트를 명시적으로 교체하며 생성은 시작하지 않는다", async () => {
    const onApply = vi.fn();
    const onRequest = vi
      .fn()
      .mockResolvedValue(["첫 아이디어", "둘째 아이디어", "셋째 아이디어"]);
    render(
      <IdeasModal
        open
        currentPrompt="기존 문장"
        onOpenChange={vi.fn()}
        onRequest={onRequest}
        onApply={onApply}
      />,
    );

    await screen.findByDisplayValue("첫 아이디어");
    fireEvent.change(screen.getByLabelText("선택한 초안 편집"), {
      target: { value: "편집한 아이디어" },
    });
    fireEvent.click(screen.getByRole("button", { name: "기존 문장 바꾸기" }));
    expect(onApply).toHaveBeenCalledWith("편집한 아이디어");
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it("아이디어 rate-limit 상세를 일반 오류로 숨기지 않는다", async () => {
    render(
      <IdeasModal
        open
        currentPrompt=""
        onOpenChange={vi.fn()}
        onRequest={vi
          .fn()
          .mockRejectedValue({ detail: "1분 뒤 다시 시도해 주세요." })}
        onApply={vi.fn()}
      />,
    );

    await screen.findByText("1분 뒤 다시 시도해 주세요.");
  });

  it("닫기·재열기 전 아이디어 응답이 새 문맥을 덮지 않는다", async () => {
    const first = deferred<string[]>();
    const second = deferred<string[]>();
    const onRequest = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const props = {
      currentPrompt: "",
      onOpenChange: vi.fn(),
      onRequest,
      onApply: vi.fn(),
    };
    const { rerender } = render(<IdeasModal open {...props} />);
    await waitFor(() => expect(onRequest).toHaveBeenCalledOnce());

    rerender(<IdeasModal open={false} {...props} />);
    rerender(<IdeasModal open {...props} />);
    await waitFor(() => expect(onRequest).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve(["새 문맥 1", "새 문맥 2", "새 문맥 3"]);
    });
    await screen.findByDisplayValue("새 문맥 1");
    await act(async () => {
      first.resolve(["오래된 문맥 1", "오래된 문맥 2", "오래된 문맥 3"]);
    });

    expect(screen.queryByText("오래된 문맥 1")).toBeNull();
    expect(screen.getByDisplayValue("새 문맥 1")).toBeTruthy();
  });

  it("한 모달 안에서 텍스트를 path로 미리 보고 저장한다", async () => {
    motifApi.previewText.mockResolvedValue({
      svg: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
      warnings: [],
      background_confidence: null,
      processed_preview_base64: null,
    });
    motifApi.importSvg.mockResolvedValue(motif);
    const onCreated = vi.fn();
    render(
      <MotifAddModal
        open
        photos={[]}
        onOpenChange={vi.fn()}
        onEnsurePhotoUpload={vi.fn()}
        onCreated={onCreated}
      />,
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("tab", { name: "텍스트·이니셜" }));
    fireEvent.change(screen.getByLabelText("짧은 글자"), {
      target: { value: "YS" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "path 미리보기 만들기" }),
    );
    await screen.findByAltText("저장할 SVG 모티프 미리보기");
    fireEvent.click(screen.getByRole("button", { name: "내 모티프에 저장" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(motif));
    expect(motifApi.previewText).toHaveBeenCalledWith({
      text: "YS",
      fontId: "nanum-gothic",
      fontWeight: 400,
      letterSpacing: 0,
    });
  });

  it("저장 중에는 닫기·탭 전환을 막고 성공 응답을 자동 선택한다", async () => {
    const stored = deferred<UserMotifOut>();
    motifApi.previewText.mockResolvedValue({
      svg: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
      warnings: [],
      background_confidence: null,
      processed_preview_base64: null,
    });
    motifApi.importSvg.mockReturnValue(stored.promise);
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <MotifAddModal
        open
        photos={[]}
        onOpenChange={onOpenChange}
        onEnsurePhotoUpload={vi.fn()}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "텍스트·이니셜" }));
    fireEvent.change(screen.getByLabelText("짧은 글자"), {
      target: { value: "YS" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "path 미리보기 만들기" }),
    );
    await screen.findByAltText("저장할 SVG 모티프 미리보기");
    fireEvent.click(screen.getByRole("button", { name: "내 모티프에 저장" }));
    await waitFor(() => expect(motifApi.importSvg).toHaveBeenCalledOnce());

    expect(
      (screen.getByRole("button", { name: "취소" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("tab", { name: "SVG 파일" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(onOpenChange).not.toHaveBeenCalled();

    await act(async () => stored.resolve(motif));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(motif));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("모티프 저장 한도 상세를 일반 오류로 숨기지 않는다", async () => {
    motifApi.previewText.mockResolvedValue({
      svg: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
      warnings: [],
      background_confidence: null,
      processed_preview_base64: null,
    });
    motifApi.importSvg.mockRejectedValue({
      detail: "내 모티프는 최대 100개까지 저장할 수 있습니다.",
    });
    render(
      <MotifAddModal
        open
        photos={[]}
        onOpenChange={vi.fn()}
        onEnsurePhotoUpload={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "텍스트·이니셜" }));
    fireEvent.change(screen.getByLabelText("짧은 글자"), {
      target: { value: "YS" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "path 미리보기 만들기" }),
    );
    await screen.findByAltText("저장할 SVG 모티프 미리보기");
    fireEvent.click(screen.getByRole("button", { name: "내 모티프에 저장" }));

    await screen.findByText("내 모티프는 최대 100개까지 저장할 수 있습니다.");
  });

  it("닫기·재열기 전 모티프 미리보기가 새 입력을 덮지 않는다", async () => {
    const first = deferred<{
      svg: string;
      warnings: string[];
      background_confidence: null;
      processed_preview_base64: null;
    }>();
    const second = deferred<{
      svg: string;
      warnings: string[];
      background_confidence: null;
      processed_preview_base64: null;
    }>();
    motifApi.previewText
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const props = {
      photos: [],
      onOpenChange: vi.fn(),
      onEnsurePhotoUpload: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(<MotifAddModal open {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "텍스트·이니셜" }));
    fireEvent.change(screen.getByLabelText("짧은 글자"), {
      target: { value: "A" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "path 미리보기 만들기" }),
    );
    await waitFor(() => expect(motifApi.previewText).toHaveBeenCalledOnce());

    rerender(<MotifAddModal open={false} {...props} />);
    rerender(<MotifAddModal open {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "텍스트·이니셜" }));
    fireEvent.change(screen.getByLabelText("짧은 글자"), {
      target: { value: "B" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "path 미리보기 만들기" }),
    );
    await waitFor(() => expect(motifApi.previewText).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({
        svg: '<svg viewBox="0 0 1 1"><path id="new" d="M0 0H1V1Z"/></svg>',
        warnings: [],
        background_confidence: null,
        processed_preview_base64: null,
      });
    });
    const currentPreview = await screen.findByAltText(
      "저장할 SVG 모티프 미리보기",
    );
    const currentSource = currentPreview.getAttribute("src");
    await act(async () => {
      first.resolve({
        svg: '<svg viewBox="0 0 1 1"><path id="old" d="M0 0H1V1Z"/></svg>',
        warnings: [],
        background_confidence: null,
        processed_preview_base64: null,
      });
    });

    expect(
      screen.getByAltText("저장할 SVG 모티프 미리보기").getAttribute("src"),
    ).toBe(currentSource);
  });

  it("sanitize 전 SVG 원본은 화면에 열지 않는다", async () => {
    motifApi.readSvg.mockResolvedValue(
      '<svg><image href="https://private.example/track"/></svg>',
    );
    render(
      <MotifAddModal
        open
        photos={[]}
        onOpenChange={vi.fn()}
        onEnsurePhotoUpload={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("SVG 파일 선택"), {
      target: {
        files: [new File(["svg"], "unsafe.svg", { type: "image/svg+xml" })],
      },
    });
    await screen.findByText("저장 후 안전한 미리보기를 표시해요");
    expect(screen.queryByAltText("저장할 SVG 모티프 미리보기")).toBeNull();
  });

  it("사진 벡터화 재시도에서 업로드를 재사용하고 처리 결과와 SVG를 구분한다", async () => {
    motifApi.uploadPhoto.mockResolvedValue("upload-1");
    motifApi.previewPhoto
      .mockRejectedValueOnce(new Error("윤곽을 찾지 못했습니다."))
      .mockResolvedValueOnce({
        svg: '<svg viewBox="0 0 1 1"><path d="M0 0"/></svg>',
        warnings: [],
        background_confidence: 0.9,
        processed_preview_base64: "AA==",
      });
    render(
      <MotifAddModal
        open
        photos={[]}
        onOpenChange={vi.fn()}
        onEnsurePhotoUpload={vi.fn()}
        onCreated={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "사진에서 만들기" }));
    const photoInput = screen
      .getAllByLabelText("벡터화할 사진 선택")
      .find((element) => element.tagName === "INPUT");
    expect(photoInput).toBeTruthy();
    fireEvent.change(photoInput as HTMLInputElement, {
      target: {
        files: [new File(["png"], "logo.png", { type: "image/png" })],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "자동 분리·벡터화" }));
    await screen.findByText("윤곽을 찾지 못했습니다.");

    fireEvent.click(screen.getByRole("button", { name: "자동 분리·벡터화" }));
    await screen.findByAltText("배경 제거와 색상 단순화를 적용한 결과");
    expect(screen.getByAltText("저장할 SVG 모티프 미리보기")).toBeTruthy();
    expect(motifApi.uploadPhoto).toHaveBeenCalledOnce();
    expect(motifApi.previewPhoto).toHaveBeenCalledTimes(2);
    expect(motifApi.previewPhoto).toHaveBeenLastCalledWith({
      uploadId: "upload-1",
      removeBackground: true,
      simplification: "medium",
      colorCount: 4,
    });
  });

  it("모티프 모달을 다시 열면 이전 새 사진 미리보기를 정리한다", () => {
    const props = {
      photos: [],
      onOpenChange: vi.fn(),
      onEnsurePhotoUpload: vi.fn(),
      onCreated: vi.fn(),
    };
    const { rerender } = render(<MotifAddModal open {...props} />);

    fireEvent.click(screen.getByRole("tab", { name: "사진에서 만들기" }));
    const photoInput = screen
      .getAllByLabelText("벡터화할 사진 선택")
      .find((element) => element.tagName === "INPUT");
    fireEvent.change(photoInput as HTMLInputElement, {
      target: {
        files: [new File(["png"], "logo.png", { type: "image/png" })],
      },
    });
    expect(screen.getByAltText("벡터화할 원본")).toBeTruthy();

    rerender(<MotifAddModal open={false} {...props} />);
    rerender(<MotifAddModal open {...props} />);
    fireEvent.click(screen.getByRole("tab", { name: "사진에서 만들기" }));

    expect(screen.queryByAltText("벡터화할 원본")).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
