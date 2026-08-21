import { domToPng } from "modern-screenshot";

/** 작업지시서 PNG — 래퍼 배경이 투명해서 backgroundColor를 주지 않으면 검게 나온다. */
export async function downloadWorksheetPng(
  node: HTMLElement,
  filename: string,
) {
  const backgroundColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-bg-layer-default")
    .trim();
  const dataUrl = await domToPng(node, {
    scale: 2,
    backgroundColor,
    // 작업장에 넘길 이미지라 조작 컨트롤은 담지 않는다.
    filter: (target) =>
      !(target instanceof Element && target.hasAttribute("data-capture-hide")),
  });
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  link.click();
}
