import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  issue: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@essesion/api-client", () => ({
  createAdminProductImageUploadUrl: api.issue,
  completeAdminProductImageUpload: api.complete,
  deleteAdminProductImageUpload: api.remove,
}));

import { uploadProductImage } from "./upload";

describe("uploadProductImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.complete.mockResolvedValue({
      data: {
        upload_id: "00000000-0000-4000-8000-000000000101",
        kind: "primary",
        public_url: "https://assets.example/product.webp",
        content_type: "image/webp",
        size_bytes: 5,
        completed_at: "2026-07-12T01:00:00Z",
      },
    });
  });

  it("실제 GCS에서는 서명 헤더로 PUT한 뒤 완료 API를 호출한다", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    api.issue.mockResolvedValue({
      data: {
        upload_id: "00000000-0000-4000-8000-000000000101",
        upload_url: "https://storage.example/signed",
        required_headers: {
          "Content-Type": "image/webp",
          "x-goog-content-length-range": "1,10485760",
          "x-goog-if-generation-match": "0",
        },
        expires_at: "2026-07-13T01:00:00Z",
      },
    });
    const file = new File(["image"], "product.webp", {
      type: "image/webp",
    });

    const result = await uploadProductImage(file, "primary");

    expect(fetch).toHaveBeenCalledWith(
      "https://storage.example/signed",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "image/webp",
          "x-goog-content-length-range": "1,10485760",
          "x-goog-if-generation-match": "0",
        },
        body: file,
      }),
    );
    expect(api.complete).toHaveBeenCalledWith({
      path: { upload_id: "00000000-0000-4000-8000-000000000101" },
      throwOnError: true,
    });
    expect(result).toEqual({
      uploadId: "00000000-0000-4000-8000-000000000101",
      publicUrl: "https://assets.example/product.webp",
    });
  });

  it("PUT이 실패하면 완료 API를 호출하지 않는다", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 403 }),
    );
    api.issue.mockResolvedValue({
      data: {
        upload_id: "00000000-0000-4000-8000-000000000101",
        upload_url: "https://storage.example/signed",
        required_headers: { "Content-Type": "image/webp" },
        expires_at: "2026-07-13T01:00:00Z",
      },
    });
    const file = new File(["image"], "product.webp", {
      type: "image/webp",
    });

    await expect(uploadProductImage(file, "detail")).rejects.toThrow(
      "상품 이미지를 업로드하지 못했습니다.",
    );
    expect(api.issue).toHaveBeenCalledWith({
      body: {
        kind: "detail",
        filename: "product.webp",
        content_type: "image/webp",
        size_bytes: file.size,
      },
      throwOnError: true,
    });
    expect(api.complete).not.toHaveBeenCalled();
  });
});
