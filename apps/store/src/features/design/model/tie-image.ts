import { TIE_GEOMETRY } from "@essesion/shared";

import { svgTileScale } from "./svg-preview";

const SILHOUETTE_URL = "/images/tie.svg";
const SHADOW_URL = "/images/tie-shadow.png";
// 아트 박스(넥타이+그림자) 폭. 1800×3919px — 그림자 원본(397px)을 넘게 확대하지만
// 알파 그라디언트라 부드럽게 늘어난다. 패턴은 벡터라 이 배율에서도 선명하다.
const OUTPUT_WIDTH_PX = 1800;

export type TieLayout = {
  width: number;
  height: number;
  /** 패턴이 반복되는 마스크 박스 (CSS의 마스크 박스와 동일). */
  mask: { x: number; y: number; width: number; height: number };
  /** 마스크 박스에 contain으로 맞춘 실루엣 위치. */
  silhouette: { x: number; y: number; width: number; height: number };
  /** 타일 한 장의 변 길이(정사각). */
  tile: number;
};

/** 미리보기(TieCanvas)의 CSS 기하를 픽셀로 옮긴 것 — 화면과 같은 그림이 되는 근거. */
export function tieLayout(
  width: number,
  silhouetteAspect: number,
  tileScale = 1,
): TieLayout {
  const { artAspect, maskTop, maskHeight, tileFraction } = TIE_GEOMETRY;
  const height = width * artAspect;
  const mask = {
    x: 0,
    y: maskTop * height,
    width,
    height: maskHeight * height,
  };
  const silhouetteWidth = Math.min(mask.width, mask.height * silhouetteAspect);
  const silhouetteHeight = silhouetteWidth / silhouetteAspect;
  return {
    width,
    height,
    mask,
    silhouette: {
      x: mask.x + (mask.width - silhouetteWidth) / 2,
      y: mask.y + (mask.height - silhouetteHeight) / 2,
      width: silhouetteWidth,
      height: silhouetteHeight,
    },
    tile: mask.width * tileFraction.tie * tileScale,
  };
}

/**
 * 화면의 넥타이 미리보기를 그대로 PNG로 합성한다 —
 * 타일 반복 → 실루엣 마스크(destination-in) → 그림자 오버레이.
 * 서버 래스터로는 못 만든다: mask·<image>가 svg_safety 화이트리스트에 없다.
 */
export async function renderTiePng(designSvg: string): Promise<Blob> {
  const silhouetteSvg = await (await fetch(SILHOUETTE_URL)).text();
  const viewBox = new DOMParser()
    .parseFromString(silhouetteSvg, "image/svg+xml")
    .documentElement.getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  if (!viewBox?.[2] || !viewBox[3]) {
    throw new Error("넥타이 모양을 불러오지 못했습니다.");
  }
  const layout = tieLayout(
    OUTPUT_WIDTH_PX,
    viewBox[2] / viewBox[3],
    svgTileScale(designSvg),
  );

  // SVG는 intrinsic 크기를 목표 픽셀로 맞춰야 캔버스에서 선명하게 래스터된다.
  const [tile, silhouette, shadow] = await Promise.all([
    svgImage(designSvg, layout.tile, layout.tile),
    svgImage(silhouetteSvg, layout.silhouette.width, layout.silhouette.height),
    loadImage(SHADOW_URL),
  ]);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layout.width);
  canvas.height = Math.round(layout.height);
  const context = canvas.getContext("2d");
  const pattern = context?.createPattern(tile, "repeat");
  if (!context || !pattern) throw new Error("이미지를 만들지 못했습니다.");

  // background-position:center — 타일 격자를 마스크 박스 중앙에 맞춘다.
  const offsetX = (layout.mask.width - layout.tile) / 2;
  const offsetY = (layout.mask.height - layout.tile) / 2;
  context.save();
  context.translate(layout.mask.x + offsetX, layout.mask.y + offsetY);
  context.fillStyle = pattern;
  context.fillRect(-offsetX, -offsetY, layout.mask.width, layout.mask.height);
  context.restore();

  context.globalCompositeOperation = "destination-in"; // = CSS mask-image
  const { x, y, width, height } = layout.silhouette;
  context.drawImage(silhouette, x, y, width, height);
  context.globalCompositeOperation = "source-over";
  context.drawImage(shadow, 0, 0, layout.width, layout.height);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("이미지를 만들지 못했습니다."));
    }, "image/png");
  });
}

async function svgImage(svg: string, width: number, height: number) {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  document.documentElement.setAttribute("width", `${width}`);
  document.documentElement.setAttribute("height", `${height}`);
  const source = new XMLSerializer().serializeToString(document);
  return loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`,
  );
}

async function loadImage(src: string) {
  const image = new Image();
  image.src = src;
  await image.decode();
  return image;
}
