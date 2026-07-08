#!/usr/bin/env node
/* 디자인 시스템 하네스 정적 검사 — packages/shared/AGENTS.md 규칙 0의 기계적 강제.
   위반 시 exit 1. 줄 끝 `// harness-ignore` 주석으로 개별 예외(사유 필수). */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const TARGET_DIRS = [
  "apps/store/src",
  "apps/admin/src",
  "packages/shared/src/components",
];

const DEFAULT_COLORS =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_PREFIXES =
  "bg|text|border|outline|ring|fill|stroke|from|via|to|divide|accent|caret|decoration";

const RULES = [
  {
    name: "arbitrary-value",
    hint: "임의 값 유틸리티 금지 — 토큰 유틸리티/프리미티브 prop 사용",
    regex: /[A-Za-z][\w-]*-\[[^\]]+\]/g,
    allow: (match) =>
      /^(data-|aria-|supports-|has-|min-|max-|nth-|peer-data|group-data)/.test(
        match,
      ),
  },
  {
    name: "raw-hex",
    hint: "raw hex 색상 금지 — theme.css 토큰만",
    regex: /#[0-9a-fA-F]{3,8}\b/g,
  },
  {
    name: "default-palette",
    hint: "Tailwind 기본 팔레트는 제거됨(무스타일) — 시맨틱 토큰 유틸리티 사용",
    regex: new RegExp(
      `\\b(?:${COLOR_PREFIXES})-(?:${DEFAULT_COLORS})-\\d{2,3}\\b`,
      "g",
    ),
  },
  {
    name: "dead-utility",
    hint: "기본 폰트/라운드/그림자 유틸리티는 제거됨 — text-t*/rounded-r*/shadow-s* 사용",
    regex:
      /\b(?:text-(?:xs|sm|base|lg|xl|[2-9]xl)|rounded-(?:xs|sm|md|lg|xl|[23]xl)(?:-[a-z]+)?|shadow-(?:2xs|xs|sm|md|lg|xl|2xl))\b/g,
  },
  {
    name: "palette-escape",
    hint: "palette.* 직접 사용 금지 — 시맨틱 토큰이 없으면 토큰 추가를 제안",
    regex: /["'`]palette\./g,
  },
  {
    name: "inline-font-size",
    hint: "fontSize 직접 지정 금지 — Text + textStyle 사용",
    regex: /\bfontSize:/g,
    allowFile: (file) =>
      file.endsWith("packages/shared/src/components/text.tsx"),
  },
];

function collectFiles(dir) {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(
        (e) =>
          e.isFile() &&
          /\.(ts|tsx)$/.test(e.name) &&
          !/\.test\.(ts|tsx)$/.test(e.name),
      )
      .map((e) => join(e.parentPath, e.name));
  } catch {
    return []; // 디렉토리가 아직 없으면 스킵
  }
}

let violations = 0;
for (const dir of TARGET_DIRS) {
  for (const file of collectFiles(dir)) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.includes("harness-ignore")) return;
      for (const rule of RULES) {
        if (rule.allowFile?.(file)) continue;
        for (const match of line.matchAll(rule.regex)) {
          if (rule.allow?.(match[0])) continue;
          violations++;
          console.error(
            `${file}:${i + 1} [${rule.name}] ${match[0]}\n  → ${rule.hint}`,
          );
        }
      }
    });
  }
}

if (violations > 0) {
  console.error(
    `\n하네스 위반 ${violations}건. 규칙: packages/shared/AGENTS.md · 예외는 토큰/컴포넌트 추가 제안이 먼저다.`,
  );
  process.exit(1);
}
console.log("check-harness: OK");
