import { domToPng } from "modern-screenshot";

/** 작업지시서는 작업장이 폰으로 본다 — 캡처 순간에만 모바일 폭으로 좁혀 찍는다. */
const CAPTURE_WIDTH_PX = 390;

/** 작업지시서 PNG — 래퍼 배경이 투명해서 backgroundColor를 주지 않으면 검게 나온다. */
export async function downloadWorksheetPng(
  node: HTMLElement,
  filename: string,
) {
  const backgroundColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--color-bg-layer-default")
    .trim();
  // 폭은 실제 DOM에서 줄여야 한다 — modern-screenshot은 계산된 px 폭을 복제본에
  // 그대로 박아 넣어서, 캡처 옵션으로 좁히면 레이아웃이 다시 흐르지 않는다.
  // 이미 좁은 화면(모바일)에서는 손대지 않는다 — 넓히면 캡처 순간 가로로 넘친다.
  const previousWidth = node.style.width;
  if (node.offsetWidth > CAPTURE_WIDTH_PX) {
    node.style.width = `${CAPTURE_WIDTH_PX}px`;
  }
  try {
    const dataUrl = await domToPng(node, {
      // 390px를 폰 해상도(3x)에 맞춰 뜬다 — 폭이 좁아져 총 픽셀은 예전보다 적다.
      scale: 3,
      backgroundColor,
      // 작업장에 넘길 이미지라 조작 컨트롤은 담지 않는다.
      filter: (target) =>
        !(
          target instanceof Element && target.hasAttribute("data-capture-hide")
        ),
    });
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = filename;
    link.click();
  } finally {
    node.style.width = previousWidth;
  }
}
