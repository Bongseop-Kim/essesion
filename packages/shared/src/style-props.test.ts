import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { breakpoints, pickResponsive } from "./breakpoint";
import { cn } from "./cn";
import {
  resolveBoxStyle,
  resolveColor,
  resolveRadius,
  resolveShadow,
  resolveSize,
  resolveSpacing,
  splitStyleProps,
} from "./style-props";
import {
  bgRoles,
  fgRoles,
  radiusSteps,
  shadowSteps,
  spacingSteps,
  strokeRoles,
  textSteps,
} from "./tokens";

describe("리졸버: 토큰 → var(), 비토큰은 raw 통과", () => {
  it("resolveColor", () => {
    expect(resolveColor("fg.neutral")).toBe("var(--color-fg-neutral)");
    expect(resolveColor("bg.brand-solid")).toBe("var(--color-bg-brand-solid)");
    expect(resolveColor("stroke.focus-ring")).toBe(
      "var(--color-stroke-focus-ring)",
    );
    expect(resolveColor("palette.gray-100")).toBe(
      "var(--color-palette-gray-100)",
    );
    expect(resolveColor("transparent")).toBe("transparent");
    expect(resolveColor("#111111")).toBe("#111111");
  });

  it("resolveSpacing", () => {
    expect(resolveSpacing("x1_5")).toBe("var(--spacing-x1_5)");
    expect(resolveSpacing("x16")).toBe("var(--spacing-x16)");
    expect(resolveSpacing(0)).toBe(0);
    expect(resolveSpacing("auto")).toBe("auto");
    expect(resolveSpacing("50%")).toBe("50%");
  });

  it("resolveSize", () => {
    expect(resolveSize("full")).toBe("100%");
    expect(resolveSize("x4")).toBe("var(--spacing-x4)");
    expect(resolveSize(240)).toBe(240);
  });

  it("resolveRadius / resolveShadow", () => {
    expect(resolveRadius("r2")).toBe("var(--radius-r2)");
    expect(resolveRadius("full")).toBe("var(--radius-full)");
    expect(resolveRadius(0)).toBe(0);
    expect(resolveShadow("s1")).toBe("var(--shadow-s1)");
    expect(resolveShadow("none")).toBe("none");
  });
});

describe("pickResponsive", () => {
  it("단일 값은 그대로", () => {
    expect(pickResponsive("x4", "md")).toBe("x4");
    expect(pickResponsive(0, "base")).toBe(0);
  });

  it("하향 fallback: xl→lg→md→sm→base", () => {
    const v = { base: "x2", md: "x6" } as const;
    expect(pickResponsive(v, "base")).toBe("x2");
    expect(pickResponsive(v, "sm")).toBe("x2");
    expect(pickResponsive(v, "md")).toBe("x6");
    expect(pickResponsive(v, "xl")).toBe("x6");
  });

  it("base 미지정 + 하위 브레이크포인트면 undefined", () => {
    expect(pickResponsive({ md: "x6" }, "base")).toBeUndefined();
  });
});

describe("resolveBoxStyle", () => {
  it("별칭 우선순위: p < px/py < pt…", () => {
    const style = resolveBoxStyle({ p: "x4", pl: "x2" }, "base");
    expect(style.paddingLeft).toBe("var(--spacing-x2)");
    expect(style.paddingTop).toBe("var(--spacing-x4)");
    expect(style.paddingRight).toBe("var(--spacing-x4)");
    expect(style.paddingBottom).toBe("var(--spacing-x4)");
  });

  it("반응형 pre-pass", () => {
    const style = resolveBoxStyle({ p: { base: "x2", md: "x6" } }, "lg");
    expect(style.paddingTop).toBe("var(--spacing-x6)");
  });

  it("borderWidth는 border-style: solid 동반", () => {
    const style = resolveBoxStyle({ borderWidth: 1 }, "base");
    expect(style.borderWidth).toBe(1);
    expect(style.borderStyle).toBe("solid");
  });

  it("boolean 정규화: grow true→1, wrap true→'wrap'", () => {
    const style = resolveBoxStyle({ flexGrow: true, flexWrap: true }, "base");
    expect(style.flexGrow).toBe(1);
    expect(style.flexWrap).toBe("wrap");
  });

  it("gridColumn 숫자 → span", () => {
    const style = resolveBoxStyle({ gridColumn: 2 }, "base");
    expect(style.gridColumn).toBe("span 2 / span 2");
  });
});

describe("splitStyleProps", () => {
  it("style prop과 DOM prop 분리", () => {
    const onClick = () => {};
    const { styleProps, elementProps } = splitStyleProps({
      p: "x4",
      bg: "bg.layer-default",
      onClick,
      className: "extra",
      style: { opacity: 0.5 },
      "aria-label": "닫기",
    });
    expect(styleProps).toEqual({ p: "x4", bg: "bg.layer-default" });
    expect(elementProps).toEqual({
      onClick,
      className: "extra",
      style: { opacity: 0.5 },
      "aria-label": "닫기",
    });
  });
});

describe("cn: 커스텀 토큰 클래스 병합", () => {
  it("text-t*(크기)와 text-fg-*(색)는 다른 그룹 — 서로 제거하지 않는다", () => {
    expect(cn("text-fg-contrast", "text-t3")).toBe("text-fg-contrast text-t3");
    expect(cn("text-t3", "text-t4")).toBe("text-t4");
  });
});

describe("드리프트 가드: tokens.ts ↔ theme.css ↔ breakpoint.ts", () => {
  const css = readFileSync(new URL("./theme.css", import.meta.url), "utf8");

  it("@theme static 유지 — 제거 시 프리미티브가 조용히 무스타일이 됨", () => {
    expect(css).toContain("@theme static");
  });

  it("모든 토큰 이름이 theme.css에 선언돼 있다", () => {
    const declarations = [
      ...fgRoles.map((r) => `--color-fg-${r}:`),
      ...bgRoles.map((r) => `--color-bg-${r}:`),
      ...strokeRoles.map((r) => `--color-stroke-${r}:`),
      ...spacingSteps.map((s) => `--spacing-${s}:`),
      ...radiusSteps.map((r) => `--radius-${r}:`),
      ...shadowSteps.map((s) => `--shadow-${s}:`),
      ...textSteps.flatMap((t) => [
        `--text-${t}:`,
        `--text-${t}--line-height:`,
      ]),
    ];
    for (const decl of declarations) {
      expect(css, `theme.css에 ${decl} 누락`).toContain(decl);
    }
  });

  it("브레이크포인트 값 동기", () => {
    for (const [bp, min] of Object.entries(breakpoints)) {
      expect(css).toContain(`--breakpoint-${bp}: ${min}px;`);
    }
  });
});
