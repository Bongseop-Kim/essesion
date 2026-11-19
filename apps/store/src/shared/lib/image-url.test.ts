import { describe, expect, it } from "vitest";

import { resizedImage } from "./image-url";

describe("resizedImage", () => {
  it("assets 출처 이미지는 변환 URL과 원본 폴백을 돌려준다", () => {
    const url = "https://assets.essesion.com/products/a.png";
    expect(resizedImage(url, 600)).toEqual({
      src: `/cdn-cgi/image/width=600,format=auto,quality=80,onerror=redirect/${url}`,
      fallbackSrc: url,
    });
  });

  it("DB 갱신 전의 구 assets 호스트(.shop) 이미지도 변환한다", () => {
    const url = "https://assets.essesion.shop/products/a.png";
    expect(resizedImage(url, 1200).src).toBe(
      `/cdn-cgi/image/width=1200,format=auto,quality=80,onerror=redirect/${url}`,
    );
  });

  it("그 외 출처와 빈 값은 그대로 둔다", () => {
    const local = "http://localhost:4443/assets/products/a.png";
    expect(resizedImage(local, 1200)).toEqual({ src: local });
    expect(resizedImage(null, 1200)).toEqual({ src: undefined });
  });
});
