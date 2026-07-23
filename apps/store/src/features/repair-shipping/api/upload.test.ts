import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  createUploadUrl: vi.fn(),
  registerRepairShippingUpload: vi.fn(),
}));
const upload = vi.hoisted(() => ({
  putIfRequired: vi.fn(),
  validateImageFile: vi.fn(),
}));

vi.mock("@essesion/api-client", () => api);
vi.mock("@/shared/lib/upload", () => ({
  ...upload,
  IMAGE_ACCEPT: "image/*",
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
}));

import { uploadRepairShippingPhoto } from "./upload";

beforeEach(() => {
  vi.clearAllMocks();
});

it("파일 크기와 발급 헤더·upload id를 완료 요청까지 보존한다", async () => {
  const file = new File(["photo"], "repair.png", { type: "image/png" });
  const requiredHeaders = {
    "Content-Type": "image/png",
    "x-goog-content-length-range": "1,10485760",
    "x-goog-if-generation-match": "0",
  };
  api.createUploadUrl.mockResolvedValue({
    data: {
      upload_id: "upload-1",
      object_key: "uploads/repair_shipping_upload/photo.png",
      upload_url: "https://upload.invalid/signed",
      upload_required: true,
      required_headers: requiredHeaders,
    },
  });
  api.registerRepairShippingUpload.mockResolvedValue({
    data: { object_key: "uploads/repair_shipping_upload/photo.png" },
  });

  await expect(uploadRepairShippingPhoto(file)).resolves.toBe(
    "uploads/repair_shipping_upload/photo.png",
  );
  expect(api.createUploadUrl).toHaveBeenCalledWith({
    body: {
      kind: "repair_shipping_upload",
      filename: "repair.png",
      content_type: "image/png",
      size_bytes: file.size,
    },
  });
  expect(upload.putIfRequired).toHaveBeenCalledWith(
    expect.objectContaining({
      upload_url: "https://upload.invalid/signed",
      required_headers: requiredHeaders,
      upload_required: true,
    }),
    file,
    "사진을 업로드하지 못했습니다.",
  );
  expect(api.registerRepairShippingUpload).toHaveBeenCalledWith({
    body: { upload_id: "upload-1" },
  });
});
