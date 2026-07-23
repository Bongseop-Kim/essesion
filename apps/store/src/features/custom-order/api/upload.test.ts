import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  completeOrderImage: vi.fn(),
  createUploadUrl: vi.fn(),
}));
const uploads = vi.hoisted(() => ({
  putIfRequired: vi.fn(),
  validateImageFile: vi.fn(),
}));

vi.mock("@essesion/api-client", () => api);
vi.mock("@/shared/lib/upload", () => ({
  IMAGE_ACCEPT: "image/png",
  ...uploads,
}));

import { uploadOrderImage } from "./upload";

const file = {
  name: "reference.png",
  type: "image/png",
  size: 128,
} as File;

describe("uploadOrderImage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("주문 이미지는 업로드 완료 확인 뒤 upload_id만 반환한다", async () => {
    api.createUploadUrl.mockResolvedValue({
      data: {
        object_key: "uploads/custom_order/private.png",
        upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23",
        upload_url: "https://upload.test/signed",
        required_headers: {
          "Content-Type": "image/png",
          "x-goog-if-generation-match": "0",
        },
        upload_required: true,
      },
    });
    api.completeOrderImage.mockResolvedValue({
      data: { upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23" },
    });

    await expect(uploadOrderImage(file, "custom_order")).resolves.toEqual({
      upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23",
    });
    expect(uploads.putIfRequired).toHaveBeenCalledWith(
      expect.objectContaining({
        upload_url: "https://upload.test/signed",
        required_headers: {
          "Content-Type": "image/png",
          "x-goog-if-generation-match": "0",
        },
        upload_required: true,
      }),
      file,
    );
    expect(api.completeOrderImage).toHaveBeenCalledWith({
      path: { upload_id: "89dc3b35-9ca2-4b18-a0e0-02a099d76a23" },
    });
  });

  it("견적 이미지는 검증용 object_key 계약을 유지한다", async () => {
    api.createUploadUrl.mockResolvedValue({
      data: {
        object_key: "uploads/quote_request/private.png",
        upload_id: "807af2cf-c9f4-4d33-b9d6-8be054e63292",
        upload_url: "dry-run://upload",
        required_headers: {},
        upload_required: false,
      },
    });

    await expect(uploadOrderImage(file, "quote_request")).resolves.toEqual({
      object_key: "uploads/quote_request/private.png",
    });
    expect(api.completeOrderImage).not.toHaveBeenCalled();
  });

  it("주문 업로드 ID가 발급되지 않으면 초안에 키를 남기지 않는다", async () => {
    api.createUploadUrl.mockResolvedValue({
      data: {
        object_key: "uploads/custom_order/private.png",
        upload_id: null,
        upload_url: "dry-run://upload",
        required_headers: {},
        upload_required: false,
      },
    });

    await expect(uploadOrderImage(file, "custom_order")).rejects.toThrow(
      "이미지 업로드 식별자를 확인하지 못했습니다.",
    );
    expect(api.completeOrderImage).not.toHaveBeenCalled();
  });
});
